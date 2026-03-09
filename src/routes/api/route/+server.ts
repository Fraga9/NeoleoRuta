/**
 * Route planning endpoint.
 * Returns structured RoutePlan + NLG text for the chat.
 * Single source of truth for all routing.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject, generateText } from 'ai';
import { env } from '$env/dynamic/private';
import { planRoute, planRouteFromCoords } from '$lib/server/planRoute';
import { haversineDistance } from '$lib/engine/transitGraph';
import { z } from 'zod';
import { json } from '@sveltejs/kit';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY || '',
});

export const POST = async ({ request }: { request: Request }) => {
  const { message, userLocation } = await request.json() as {
    message: string;
    userLocation?: [number, number] | null;
  };

  if (!message) {
    return json({ plan: null, nlgText: null, error: null });
  }

  try {
    // Step 1: NLU
    const { object: intent } = await generateObject({
      model: google('gemini-2.5-flash'),
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

    console.log('[ROUTE NLU] Intent:', intent);

    if (!intent.isRouteQuery || !intent.destination) {
      return json({ plan: null, nlgText: null, error: null });
    }

    // Step 2: Deterministic routing (with OSRM enrichment built-in)
    let result;
    if (intent.origin && intent.origin.trim()) {
      result = await planRoute(intent.origin, intent.destination);
    } else if (userLocation) {
      console.log('[ROUTE] Using GPS location as origin:', userLocation);
      result = await planRouteFromCoords('Tu ubicación actual', userLocation, intent.destination);
    } else {
      result = await planRoute('Centro de Monterrey', intent.destination);
    }

    if (result.error || !result.plan) {
      // If there's a taxi suggestion, return the error message as nlgText
      const nlgText = result.error?.message || 'No se pudo calcular la ruta.';
      return json({ plan: null, nlgText, error: result.error });
    }

    const plan = result.plan;

    // Step 3: NLG — generate text from the route plan
    // Detect transport-mode walk steps (>1.5km Haversine = taxi, not walking)
    const routeDescription = plan.steps.map((s: any, i: number) => {
      if (s.type === 'walk') {
        const straightLine = haversineDistance(s.fromCoords, s.toCoords);
        const isTaxi = straightLine > 1500; // >1.5km straight line = definitely needs taxi
        if (isTaxi) {
          return `${i + 1}. 🚕 Taxi/Uber de "${s.from}" a "${s.to}" (~${s.duration} min)`;
        }
        return `${i + 1}. 🚶 Caminar de "${s.from}" a "${s.to}" (~${s.duration} min)`;
      }
      if (s.type === 'transit') {
        const lineName = s.routeId === 'ecovia' ? 'Ecovía' : `Metro Línea ${s.routeId?.split('-')[1]}`;
        return `${i + 1}. 🚇 Tomar ${lineName} desde "${s.from}" hasta "${s.to}" (${s.stopsCount} paradas, ~${s.duration} min)`;
      }
      if (s.type === 'transfer') {
        return `${i + 1}. 🔄 Transbordo en "${s.from}" (~${s.duration} min)`;
      }
      return '';
    }).join('\n');

    // Step 4: NLG — generate friendly text (with fallback if Gemini fails)
    let nlgText: string;
    try {
      // Check if any walk segment is actually a taxi/bus trip
      const hasTransportLeg = plan.steps.some((s: any) =>
        s.type === 'walk' && haversineDistance(s.fromCoords, s.toCoords) > 1500
      );
      const transportTip = hasTransportLeg
        ? '\nNOTA: Los tramos marcados con 🚕 son demasiado largos para caminar. Recomienda taxi, Uber o Didi para esas partes.'
        : '';

      const { text } = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: `Eres "RegioRuta Inteligente", asistente de transporte en Monterrey, NL.
Tono: amable, con modismos locales ligeros ("camión", "feria", "qué onda").

Explica esta ruta calculada de forma clara y breve. NO inventes otra ruta, describe EXACTAMENTE esta:

Origen: ${plan.origin.name}
Destino: ${plan.destination.name}
Tiempo total: ~${plan.totalDuration} minutos
Pasos:
${routeDescription}
${transportTip}

Escribe la explicación en 1-2 párrafos cortos. Sé conciso.`,
      });
      nlgText = text;
    } catch (nlgError) {
      console.error('[ROUTE NLG] Gemini failed, using fallback text:', nlgError);
      // Fallback: return the structured route description as plain text
      nlgText = `Ruta de ${plan.origin.name} a ${plan.destination.name} (~${plan.totalDuration} min):\n\n${routeDescription}`;
    }

    return json({ plan, nlgText, error: null });
  } catch (e) {
    console.error('[ROUTE API] Error:', e);
    return json({ plan: null, nlgText: null, error: 'Error interno calculando la ruta.' });
  }
};
