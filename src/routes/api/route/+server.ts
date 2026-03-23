/**
 * Route planning endpoint — 2-phase SSE response.
 *
 * Phase 1: NLU + RAPTOR + OSRM → sends `event: plan` (~2-5s)
 *          The frontend draws the map immediately.
 * Phase 2: NLG streaming → sends `event: nlg-chunk` tokens progressively.
 *          Text appears word-by-word in the chat.
 * Final:   `event: done` closes the stream.
 *
 * Fallback: If NLG fails, a mechanical text is sent as a single chunk.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject, streamText } from 'ai';
import { env } from '$env/dynamic/private';
import { planRoute, planRouteFromCoords, buildPlanDirect, type PlanResult } from '$lib/server/planRoute';
import { haversineDistance } from '$lib/engine/raptorData';
import { transitRoutes } from '$lib/data/transitRoutes';
import { resolveCoordinates } from '$lib/data/knownPlaces';
import { z } from 'zod';
import { json } from '@sveltejs/kit';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY || '',
});

// ── Accent normalization ──
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Fast NLU: regex patterns for common route queries ──
// All patterns work on accent-normalized input.
// Pre-compiled regexes for performance (no template literal escaping issues).

// Pattern 1: "de/desde X a/hasta/hacia Y" (origin first)
// Greedy (.+) for origin so "de Plaza la Silla a Fundidora" splits at last "a"
const P1 = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+)?de(?:sde)?\s+(.+)\s+(?:a|hasta|hacia)\s+(.+?)[?.!]?\s*$/i;

// Pattern 2a: "VERB a/al Y desde X" (destination first, with origin)
const P2A = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+(?:a|al|a\s+la|a\s+el)\s+(.+?)\s+desde\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 2b: "VERB a/al Y" (destination only, no origin)
const P2B = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+(?:a|al|a\s+la|a\s+el)\s+(.+?)[?.!]?\s*$/i;

// Pattern 3a: "ruta a Y desde X"
const P3A = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?ruta\s+(?:a|al|a\s+la|a\s+el)\s+(.+?)\s+desde\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 3b: "ruta a/al/hacia Y"
const P3B = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?ruta\s+(?:a|al|a\s+la|hacia)\s+(.+?)[?.!]?\s*$/i;

function fastNLU(message: string): { origin?: string; destination?: string } | null {
  const raw = message.trim();
  const m = norm(raw);

  const m1 = m.match(P1);
  if (m1) return { origin: m1[1].trim(), destination: m1[2].trim() };

  const m2a = m.match(P2A);
  if (m2a) return { origin: m2a[2].trim(), destination: m2a[1].trim() };

  const m2b = m.match(P2B);
  if (m2b) return { destination: m2b[1].trim() };

  const m3a = m.match(P3A);
  if (m3a) return { origin: m3a[2].trim(), destination: m3a[1].trim() };

  const m3b = m.match(P3B);
  if (m3b) return { destination: m3b[1].trim() };

  // Pattern 4: Implicit destination — bare place name that exists in knownPlaces
  // Only match short inputs (≤4 words) that don't look like questions
  const wordCount = raw.split(/\s+/).length;
  const looksLikeQuestion = /^[¿?]|(?:^|\s)(?:qu[eé]|c[oó]mo|cu[aá]l|d[oó]nde|por\s*qu[eé]|cu[aá]nto)/i.test(m);
  if (wordCount <= 4 && !looksLikeQuestion && resolveCoordinates(raw)) {
    return { destination: raw };
  }

  return null; // fallback to Gemini
}

// ── Build route description for NLG prompt ──
function buildRouteDescription(plan: any): string {
  return plan.steps.map((s: any, i: number) => {
    if (s.type === 'walk') {
      const straightLine = haversineDistance(s.fromCoords, s.toCoords);
      const isTaxi = straightLine > 1500;
      if (isTaxi) {
        return `${i + 1}. 🚕 Taxi/Uber de "${s.from}" a "${s.to}" (~${s.duration} min)`;
      }
      return `${i + 1}. 🚶 Caminar de "${s.from}" a "${s.to}" (~${s.duration} min)`;
    }
    if (s.type === 'transit') {
      let lineName: string;
      if (s.routeId === 'ecovia') {
        lineName = 'Ecovía';
      } else if (s.routeId?.startsWith('ruta-')) {
        const parts = s.routeId.replace('ruta-', '').replace(/-ida$/, '').replace(/-vuelta$/, '').split('-');
        lineName = `Ruta ${parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')} (camión)`;
      } else {
        lineName = `Metro Línea ${s.routeId?.split('-')[1]}`;
      }
      const icon = s.routeId?.startsWith('ruta-') ? '🚌' : '🚇';
      return `${i + 1}. ${icon} Tomar ${lineName} desde "${s.from}" hasta "${s.to}" (${s.stopsCount} paradas, ~${s.duration} min)`;
    }
    if (s.type === 'transfer') {
      return `${i + 1}. 🔄 Transbordo en "${s.from}" (~${s.duration} min)`;
    }
    return '';
  }).join('\n');
}

// ── SSE helper ──
function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const POST = async ({ request }: { request: Request }) => {
  const { message, userLocation, clarification } = await request.json() as {
    message: string;
    userLocation?: [number, number] | null;
    clarification?: {
      field: 'origin' | 'destination';
      selectedCoords: [number, number];
      selectedLabel: string;
      partialIntent: {
        origin?: string;
        originCoords?: [number, number];
        destination?: string;
        destCoords?: [number, number];
      };
    };
  };

  if (!message && !clarification) {
    return json({ plan: null, nlgText: null, error: null });
  }

  // Create SSE readable stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: string, data: any) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEvent(event, data))); } catch { closed = true; }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        const t0 = performance.now();

        let result: PlanResult;

        if (clarification) {
          // ── Clarification response — skip NLU, route with resolved coords ──
          console.log(`[ROUTE] Clarification: ${clarification.field} → "${clarification.selectedLabel}"`);
          const pi = clarification.partialIntent;

          if (clarification.field === 'destination') {
            const originName = pi.origin || 'Tu ubicación actual';
            const originCoords = pi.originCoords || userLocation || [-100.3161, 25.6866];
            const buildResult = await buildPlanDirect(
              originName, originCoords,
              clarification.selectedLabel, clarification.selectedCoords
            );
            result = buildResult.error
              ? { type: 'error', error: buildResult.error }
              : { type: 'plan', plan: buildResult.plan!, alternatives: buildResult.alternatives, error: null };
          } else {
            // Origin was clarified — destination may still need geocoding
            if (pi.destCoords) {
              const buildResult = await buildPlanDirect(
                clarification.selectedLabel, clarification.selectedCoords,
                pi.destination || '', pi.destCoords
              );
              result = buildResult.error
                ? { type: 'error', error: buildResult.error }
                : { type: 'plan', plan: buildResult.plan!, alternatives: buildResult.alternatives, error: null };
            } else {
              // Need to geocode destination still
              result = await planRouteFromCoords(
                clarification.selectedLabel, clarification.selectedCoords,
                pi.destination || ''
              );
            }
          }

        } else {
          // ── Normal flow: NLU → Routing ──
          let intent: { isRouteQuery: boolean; origin?: string; destination?: string };

          const fastResult = fastNLU(message);
          if (fastResult) {
            intent = { isRouteQuery: true, ...fastResult };
            console.log(`[TIMING] NLU (regex): ${(performance.now() - t0).toFixed(2)}ms`);
            console.log('[ROUTE NLU] Fast match:', intent);
          } else {
            const { object: geminiIntent } = await generateObject({
              model: google('gemini-2.5-flash'),
              providerOptions: {
                google: { thinkingConfig: { thinkingBudget: 0 } },
              },
              schema: z.object({
                isRouteQuery: z.boolean().describe('true si el usuario quiere saber cómo llegar a un lugar'),
                origin: z.string().optional().describe('Lugar de origen (vacío si no lo menciona)'),
                destination: z.string().optional().describe('Lugar de destino'),
              }),
              prompt: `Analiza este mensaje de un usuario de transporte público en Monterrey, NL.
¿Está preguntando cómo llegar a un lugar? Si sí, extrae el origen y destino.
Si no menciona origen, deja origin vacío.
Mensaje: "${message}"`,
            });
            intent = geminiIntent;
            console.log(`[TIMING] NLU (gemini): ${(performance.now() - t0).toFixed(0)}ms`);
            console.log('[ROUTE NLU] Gemini intent:', intent);
          }

          if (!intent.isRouteQuery || !intent.destination) {
            send('done', { plan: null, nlgText: null, error: null });
            close();
            return;
          }

          // ── Routing (RAPTOR + OSRM) ──
          const tRouteStart = performance.now();
          if (intent.origin && intent.origin.trim()) {
            result = await planRoute(intent.origin, intent.destination, userLocation ?? undefined);
          } else if (userLocation) {
            console.log('[ROUTE] Using GPS location as origin:', userLocation);
            result = await planRouteFromCoords('Tu ubicación actual', userLocation, intent.destination);
          } else {
            result = await planRoute('Centro de Monterrey', intent.destination, undefined);
          }
          console.log(`[TIMING] Routing total: ${(performance.now() - tRouteStart).toFixed(0)}ms`);
        }

        // ── Handle result ──
        if (result.type === 'clarification') {
          send('clarification', result.clarification);
          send('done', {});
          close();
          return;
        }

        if (result.type === 'error') {
          send('done', { plan: null, nlgText: result.error.message, error: result.error });
          close();
          return;
        }

        const plan = result.plan;
        const alternatives = result.alternatives ?? [];

        // ── Send plan immediately → frontend draws the map ──
        send('plan', { plan, alternatives });
        console.log(`[TIMING] Plan sent to client: ${(performance.now() - t0).toFixed(0)}ms`);

        // ── Phase 2: NLG streaming ──
        const tNLGStart = performance.now();
        const routeDescription = buildRouteDescription(plan);

        try {
          const hasTransportLeg = plan.steps.some((s: any) =>
            s.type === 'walk' && haversineDistance(s.fromCoords, s.toCoords) > 1500
          );
          const transportTip = hasTransportLeg
            ? '\nNOTA: Los tramos marcados con 🚕 son demasiado largos para caminar. Recomienda taxi, Uber o Didi para esas partes.'
            : '';

          const altSummary = alternatives.map((alt: any, i: number) => {
            const firstTransit = alt.steps.find((s: any) => s.type === 'transit');
            const lineName = firstTransit?.routeId
              ? (transitRoutes[firstTransit.routeId]?.label ?? firstTransit.routeId)
              : '?';
            return `- Opción ${i + 2}: ${lineName} (~${alt.totalDuration} min)`;
          }).join('\n');

          const JERGA = `JERGA REGIOMONTANA — úsala de forma NATURAL (1-2 frases por respuesta, sin encadenar):
"De volon pin pon"=Rápido/al tiro | "En corto"=Rápido | "Simón"=sí/claro | "La neta"=la verdad | "Órale pues"=ándale | "¡Échale!"=vamos | "Pos"=pues | "Nomás"=solo | "Está cañón"=está difícil | "Pilas"=listo/alerta | "La raza"=la gente | "¡Ya estás!"=ya quedó | "Gacho"=malo/inconveniente | "Chido/a"=cool | "No te arrugues"=échale ganas | "¡Hay te wacho!"=hasta luego`;

          const nlgResult = streamText({
            model: google('gemini-2.5-flash'),
            maxOutputTokens: 150,
            providerOptions: {
              google: { thinkingConfig: { thinkingBudget: 0 } },
            },
            prompt: `Eres "Neoleo Ruta Inteligente", asistente de transporte en Monterrey, NL.
${JERGA}

El usuario quiere ir de "${plan.origin.name}" a "${plan.destination.name}".
La ruta tardará ~${plan.totalDuration} minutos en total.${transportTip}
${altSummary ? `\nAlternativas: ${altSummary}` : ''}

Escribe UN saludo muy breve y cálido (máximo 2 oraciones). Menciona el tiempo total y si hay alternativas.
Usa 1 expresión regia natural. NO describas los pasos (ya se muestran como tarjetas visuales).`,
          });

          for await (const chunk of nlgResult.textStream) {
            send('nlg-chunk', { text: chunk });
          }
        } catch (nlgError) {
          console.error('[ROUTE NLG] Gemini failed, using fallback:', nlgError);
          const fallback = `Ruta de ${plan.origin.name} a ${plan.destination.name} (~${plan.totalDuration} min):\n\n${routeDescription}`;
          send('nlg-chunk', { text: fallback });
        }

        console.log(`[TIMING] NLG: ${(performance.now() - tNLGStart).toFixed(0)}ms`);
        console.log(`[TIMING] ═══ TOTAL: ${(performance.now() - t0).toFixed(0)}ms ═══`);

        send('done', {});
        close();
      } catch (e) {
        console.error('[ROUTE API] Error:', e);
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(sseEvent('done', {
          plan: null,
          nlgText: null,
          error: 'Error interno calculando la ruta.',
        })));
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
