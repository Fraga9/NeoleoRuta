/**
 * Route planning endpoint — 2-phase SSE response.
 *
 * Phase 1: NLU + RAPTOR + OSRM → sends `event: plan` (~2-5s)
 *          The frontend draws the map immediately.
 * Phase 2: NLG (template-based, deterministic) → sends one `nlg-chunk`.
 *          The visual cards already describe each step, so a brief greeting
 *          with rotated jerga is enough — no LLM needed here.
 * Final:   `event: done` closes the stream.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { env } from '$env/dynamic/private';
import { planRoute, planRouteFromCoords, buildPlanDirect, type PlanResult } from '$lib/server/planRoute';
import { haversineDistance, raptorData, findRoutesNearPoint, type TransportType } from '$lib/engine/raptorData';
import { geocodeMulti } from '$lib/server/geocoding';
import { fastNLU, detectLang } from '$lib/server/nlu';
import { buildRouteGreeting, formatPlanError } from '$lib/server/nlgTemplate';
import { z } from 'zod';
import { json } from '@sveltejs/kit';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY || '',
});

// Radius (meters) used by findRoutesNearPoint for "qué rutas pasan por X" queries.
// 800m covers metro stations ~750m away from typical landmark coordinates.
const ROUTES_NEAR_RADIUS_M = 800;


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
              ROUTES_NEAR_RADIUS_M,
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
              send('nlg-chunk', { text: `No encontré ${filterText} que pasen cerca de ${clarification.selectedLabel} (radio ${ROUTES_NEAR_RADIUS_M}m).` });
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
            // Resolve origin: explicit partial intent → user GPS → ASK (do NOT silently fall back to MTY center).
            const originName = pi.origin || (userLocation ? 'Tu ubicación actual' : null);
            const originCoords = pi.originCoords || userLocation || null;
            if (!originName || !originCoords) {
              send('done', {
                plan: null,
                nlgText: 'Necesito saber desde dónde sales. ¿Me das un origen, o permites el GPS?',
                error: { code: 'MISSING_ORIGIN', message: 'Origin not provided and GPS unavailable' },
              });
              close();
              return;
            }
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
                  error: { code: 'NOT_FOUND', message: 'Location not found', suggestion: null },
                });
                close();
                return;
              }
              
              // Find routes near the location
              const routes = findRoutesNearPoint(
                raptorData,
                geoResult.coords,
                ROUTES_NEAR_RADIUS_M,
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
                  text: `No encontré ${filterText} que pasen cerca de ${geoResult.label} (en un radio de ${ROUTES_NEAR_RADIUS_M}m). Prueba con una ubicación diferente.`
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
          const lang = detectLang(message ?? '');
          const friendlyMessage = formatPlanError(result.error, lang);
          send('done', {
            plan: null,
            nlgText: friendlyMessage,
            error: {
              code: result.error.code,
              message: friendlyMessage,
              suggestion: result.error.suggestion ?? null,
            },
          });
          close();
          return;
        }

        const plan = result.plan;
        const alternatives = result.alternatives ?? [];

        // ── Send plan immediately → frontend draws the map ──
        send('plan', { plan, alternatives });
        console.log(`[TIMING] Plan sent to client: ${(performance.now() - t0).toFixed(0)}ms`);

        // ── Phase 2: NLG (template-based, deterministic) ──
        const tNLGStart = performance.now();

        const hasTransportLeg = plan.steps.some((s: any) =>
          s.type === 'walk' && haversineDistance(s.fromCoords, s.toCoords) > 1500
        );
        const lang = detectLang(message ?? '');
        const greeting = buildRouteGreeting(plan, alternatives, lang, hasTransportLeg);
        send('nlg-chunk', { text: greeting });

        console.log(`[TIMING] NLG: ${(performance.now() - tNLGStart).toFixed(0)}ms`);
        console.log(`[TIMING] ═══ TOTAL: ${(performance.now() - t0).toFixed(0)}ms ═══`);

        send('done', {});
        close();
      } catch (e) {
        const errorId = crypto.randomUUID();
        console.error(`[ROUTE API] Error ${errorId}:`, e);
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(sseEvent('done', {
          plan: null,
          nlgText: `Error interno calculando la ruta. (id: ${errorId.slice(0, 8)})`,
          error: {
            code: 'INTERNAL',
            message: 'Error interno calculando la ruta.',
            errorId,
            suggestion: null,
          },
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
