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
import { haversineDistance, raptorData, findRoutesNearPoint, type TransportType } from '$lib/engine/raptorData';
import { geocodeMulti } from '$lib/server/geocoding';
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

// ── Language detection — conservative, only fires on unambiguous English signals ──
// Spanish queries with English words ("llévame al downtown") must NOT trigger this.
function detectLang(message: string): 'en' | 'es' {
  const m = message.toLowerCase();
  const enPhrases = [
    'how do i', 'how can i', 'how to get', 'how do you',
    'take me to', 'get me to', 'directions to', 'route to',
    'i want to go', 'i need to go', 'i\'m going to',
    'from the ', 'from downtown', 'from airport',
    'to the airport', 'to the stadium', 'to downtown',
    'get to ', 'going to ', 'way to ',
  ];
  return enPhrases.some(p => m.includes(p)) ? 'en' : 'es';
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

// ── Routes-near patterns (Feature 1: "qué rutas pasan por X") ──

// Pattern 5: "qué rutas/camiones/lineas pasan por X"
const P5_ROUTES_NEAR = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey)[,;]?\s+)?(?:qu[eé]\s+)?(?:rutas?|cami[oó]n(?:es)?|l[ií]neas?|transporte)\s+(?:pasan?|hay|circulan?|sirven?|llegan?)\s+(?:por|en|cerca\s+de|a)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 6: "qué metro/camión me deja cerca de X" (filtered by transport type)
const P6_FILTERED = /^¿?\s*(?:qu[eé]\s+)?(metros?|cami[oó]n(?:es)?|ecov[ií]a|rutas?|l[ií]neas?\s+de\s+metro)\s+(?:me\s+)?(?:dejan?|llevan?|pasan?|sirven?)\s+(?:cerca\s+de|por|en|a|al|hasta)\s+(?:el\s+|la\s+)?(.+?)[?.!]?\s*$/i;

// ── NLU Result Types ──

type NLURouteResult = { type: 'route'; origin?: string; destination: string };
type NLURoutesNearResult = { type: 'routes-near'; location: string; filter?: TransportType };
type NLUResult = NLURouteResult | NLURoutesNearResult | null;

function parseTransportFilter(match: string): TransportType | undefined {
  const m = match.toLowerCase();
  if (m.includes('metro') || m.includes('línea de metro') || m.includes('linea de metro')) return 'metro';
  if (m.includes('ecovia') || m.includes('ecovía')) return 'ecovia';
  if (m.includes('camion') || m.includes('camión')) return 'bus';
  // 'ruta'/'rutas' are generic — no filter (show all transport types)
  return undefined;
}

function fastNLU(message: string): NLUResult {
  const raw = message.trim();
  const m = norm(raw);

  // ── Routes-near patterns (check first, they're more specific) ──

  // P6: Filtered by transport type ("qué metro me deja cerca de...")
  const m6 = m.match(P6_FILTERED);
  if (m6) {
    return { 
      type: 'routes-near', 
      location: m6[2].trim(),
      filter: parseTransportFilter(m6[1]),
    };
  }
  
  // P5: General routes-near ("qué rutas pasan por...")
  const m5 = m.match(P5_ROUTES_NEAR);
  if (m5) {
    return { type: 'routes-near', location: m5[1].trim() };
  }

  // ── Route planning patterns ──

  const m1 = m.match(P1);
  if (m1) return { type: 'route' as const, origin: m1[1].trim(), destination: m1[2].trim() };

  const m2a = m.match(P2A);
  if (m2a) return { type: 'route' as const, origin: m2a[2].trim(), destination: m2a[1].trim() };

  const m2b = m.match(P2B);
  if (m2b) return { type: 'route' as const, destination: m2b[1].trim() };

  const m3a = m.match(P3A);
  if (m3a) return { type: 'route' as const, origin: m3a[2].trim(), destination: m3a[1].trim() };

  const m3b = m.match(P3B);
  if (m3b) return { type: 'route' as const, destination: m3b[1].trim() };

  // Pattern 4: Implicit destination — bare place name that exists in knownPlaces
  // Only match short inputs (≤4 words) that don't look like questions
  const wordCount = raw.split(/\s+/).length;
  const looksLikeQuestion = /^[¿?]|(?:^|\s)(?:qu[eé]|c[oó]mo|cu[aá]l|d[oó]nde|por\s*qu[eé]|cu[aá]nto)/i.test(m);
  if (wordCount <= 4 && !looksLikeQuestion && resolveCoordinates(raw)) {
    return { type: 'route' as const, destination: raw };
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
      field: 'origin' | 'destination' | 'location';
      selectedCoords: [number, number];
      selectedLabel: string;
      queryType?: 'routes-near';
      filter?: TransportType;
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

          // ── Routes-near location clarification ──
          if (clarification.field === 'location' && clarification.queryType === 'routes-near') {
            const routes = findRoutesNearPoint(
              raptorData,
              clarification.selectedCoords,
              800,
              userLocation ?? undefined,
              clarification.filter
            );
            console.log(`[ROUTES-NEAR] Clarification resolved: ${routes.length} routes near "${clarification.selectedLabel}"`);
            send('routes-list', {
              location: clarification.selectedLabel,
              coords: clarification.selectedCoords,
              routes,
              filter: clarification.filter,
            });
            const filterText = clarification.filter === 'metro' ? 'metro'
              : clarification.filter === 'ecovia' ? 'Ecovía'
              : 'rutas';
            if (routes.length === 0) {
              send('nlg-chunk', { text: `No encontré ${filterText} que pasen cerca de ${clarification.selectedLabel} (radio 800m).` });
            } else {
              const names = routes.slice(0, 3).map(r => r.label).join(', ');
              const more = routes.length > 3 ? ` y ${routes.length - 3} más` : '';
              send('nlg-chunk', { text: `Por ${clarification.selectedLabel} pasan ${routes.length} ${filterText}: ${names}${more}.` });
            }
            send('done', {});
            close();
            return;
          }

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
          // ── Normal flow: NLU → Routing or Routes-Near ──
          const fastResult = fastNLU(message);
          
          if (fastResult) {
            console.log(`[TIMING] NLU (regex): ${(performance.now() - t0).toFixed(2)}ms`);
            console.log('[ROUTE NLU] Fast match:', fastResult);
            
            // ── Handle routes-near queries ──
            if (fastResult.type === 'routes-near') {
              const tRoutesNear = performance.now();
              
              // Geocode the location
              const geoResult = await geocodeMulti(fastResult.location, userLocation ?? undefined);
              
              if (geoResult.status === 'ambiguous') {
                // Send clarification for location disambiguation
                send('clarification', {
                  field: 'location' as const,
                  original: fastResult.location,
                  candidates: geoResult.candidates,
                  queryType: 'routes-near',
                  filter: fastResult.filter,
                });
                send('done', {});
                close();
                return;
              }
              
              if (geoResult.status === 'not_found') {
                send('done', { 
                  plan: null, 
                  nlgText: `No encontré "${fastResult.location}". ¿Podrías ser más específico?`,
                  error: { message: 'Location not found' }
                });
                close();
                return;
              }
              
              // Find routes near the location
              const routes = findRoutesNearPoint(
                raptorData,
                geoResult.coords,
                800,  // 800m radius — covers metro stations ~750m from landmark coords
                userLocation ?? undefined,
                fastResult.filter
              );
              
              console.log(`[ROUTES-NEAR] Found ${routes.length} routes near "${geoResult.label}"`);
              console.log(`[TIMING] Routes-near total: ${(performance.now() - tRoutesNear).toFixed(0)}ms`);
              
              // Send routes list
              send('routes-list', {
                location: geoResult.label,
                coords: geoResult.coords,
                routes,
                filter: fastResult.filter,
              });
              
              // Generate friendly NLG response
              const filterText = fastResult.filter 
                ? (fastResult.filter === 'metro' ? 'metro' : fastResult.filter === 'ecovia' ? 'Ecovía' : 'camiones')
                : 'rutas';
              
              if (routes.length === 0) {
                send('nlg-chunk', { 
                  text: `No encontré ${filterText} que pasen cerca de ${geoResult.label} (en un radio de 500m). Prueba con una ubicación diferente.`
                });
              } else {
                const routeNames = routes.slice(0, 3).map(r => r.label).join(', ');
                const moreText = routes.length > 3 ? ` y ${routes.length - 3} más` : '';
                send('nlg-chunk', { 
                  text: `Por ${geoResult.label} pasan ${routes.length} ${filterText}: ${routeNames}${moreText}. Te muestro las opciones ordenadas.`
                });
              }
              
              send('done', {});
              close();
              return;
            }
            
            // ── Handle route planning queries ──
            // fastResult.type === 'route'
            const intent = fastResult;
            
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
            
          } else {
            // ── Gemini fallback for unrecognized patterns ──
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
            
            console.log(`[TIMING] NLU (gemini): ${(performance.now() - t0).toFixed(0)}ms`);
            console.log('[ROUTE NLU] Gemini intent:', geminiIntent);

            if (!geminiIntent.isRouteQuery || !geminiIntent.destination) {
              send('done', { plan: null, nlgText: null, error: null });
              close();
              return;
            }

            // ── Routing (RAPTOR + OSRM) ──
            const tRouteStart = performance.now();
            if (geminiIntent.origin && geminiIntent.origin.trim()) {
              result = await planRoute(geminiIntent.origin, geminiIntent.destination, userLocation ?? undefined);
            } else if (userLocation) {
              console.log('[ROUTE] Using GPS location as origin:', userLocation);
              result = await planRouteFromCoords('Tu ubicación actual', userLocation, geminiIntent.destination);
            } else {
              result = await planRoute('Centro de Monterrey', geminiIntent.destination, undefined);
            }
            console.log(`[TIMING] Routing total: ${(performance.now() - tRouteStart).toFixed(0)}ms`);
          }
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

          const lang = detectLang(message ?? '');

          const transportTip = hasTransportLeg
            ? lang === 'en'
              ? '\nNOTE: Segments marked with 🚕 are too far to walk. Recommend a taxi, Uber, or Didi for those parts.'
              : '\nNOTA: Los tramos marcados con 🚕 son demasiado largos para caminar. Recomienda taxi, Uber o Didi para esas partes.'
            : '';

          const altSummary = alternatives.map((alt: any, i: number) => {
            const firstTransit = alt.steps.find((s: any) => s.type === 'transit');
            const lineName = firstTransit?.routeId
              ? (transitRoutes[firstTransit.routeId]?.label ?? firstTransit.routeId)
              : '?';
            return lang === 'en'
              ? `- Option ${i + 2}: ${lineName} (~${alt.totalDuration} min)`
              : `- Opción ${i + 2}: ${lineName} (~${alt.totalDuration} min)`;
          }).join('\n');

          const JERGA = `JERGA REGIOMONTANA — úsala de forma NATURAL (1-2 frases por respuesta, sin encadenar):
"De volon pin pon"=Rápido/al tiro | "En corto"=Rápido | "Simón"=sí/claro | "La neta"=la verdad | "Órale pues"=ándale | "¡Échale!"=vamos | "Pos"=pues | "Nomás"=solo | "Está cañón"=está difícil | "Pilas"=listo/alerta | "La raza"=la gente | "¡Ya estás!"=ya quedó | "Gacho"=malo/inconveniente | "Chido/a"=cool | "No te arrugues"=échale ganas | "¡Hay te wacho!"=hasta luego`;

          const nlgPrompt = lang === 'en'
            ? `You are "Neoleo Ruta", a friendly transit assistant for Monterrey, NL, Mexico.
The user wants to go from "${plan.origin.name}" to "${plan.destination.name}".
The trip will take ~${plan.totalDuration} minutes total.${transportTip}
${altSummary ? `\nAlternatives available:\n${altSummary}` : ''}

Write ONE brief, warm greeting (max 2 sentences). Mention the total travel time and alternatives if any.
Keep it helpful and local. Do NOT describe the steps (they are shown as visual cards below).`
            : `Eres "Neoleo Ruta Inteligente", asistente de transporte en Monterrey, NL.
${JERGA}

El usuario quiere ir de "${plan.origin.name}" a "${plan.destination.name}".
La ruta tardará ~${plan.totalDuration} minutos en total.${transportTip}
${altSummary ? `\nAlternativas: ${altSummary}` : ''}

Escribe UN saludo muy breve y cálido (máximo 2 oraciones). Menciona el tiempo total y si hay alternativas.
Usa 1 expresión regia natural. NO describas los pasos (ya se muestran como tarjetas visuales).`;

          const nlgResult = streamText({
            model: google('gemini-2.5-flash'),
            maxOutputTokens: 150,
            providerOptions: {
              google: { thinkingConfig: { thinkingBudget: 0 } },
            },
            prompt: nlgPrompt,
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
