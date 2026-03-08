import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, convertToModelMessages, tool } from 'ai';
import { env } from '$env/dynamic/private';
import { getEmbedding, supabaseAdmin } from '$lib/server/supabaseAdmin';
import { z } from 'zod';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY || '',
});

export const POST = async ({ request }) => {
  const { messages } = await request.json();

  // Get the last user message to perform RAG
  const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
  const lastUserMessage = lastUserMsg?.parts?.find((p: any) => p.type === 'text')?.text
    ?? lastUserMsg?.content
    ?? '';
  
  let contextText = '';

  if (lastUserMessage) {
    try {
      // 1. Generate embedding for the user's query
      const embedding = await getEmbedding(lastUserMessage);

      // 2. Query Supabase for similar locations
      const { data: matchedLocations, error } = await supabaseAdmin.rpc('match_locations', {
        query_embedding: embedding,
        match_threshold: 0.7, // Only somewhat relevant results
        match_count: 3
      });

      if (!error && matchedLocations && matchedLocations.length > 0) {
        contextText = "CONTEXTO DE LUGARES RELEVANTES (Usa esta info si es pertinente):\n" + 
          matchedLocations.map((l: any) => `- ${l.name} (${l.category}): ${l.description}`).join('\n');
      }
    } catch (e) {
      console.error("RAG Error:", e);
    }
  }

  const systemPrompt = `
  Eres "RegioRuta Inteligente", un experto asistente de transporte público en Monterrey, NL.
  Tu objetivo es ayudar a la gente a llegar a distintos lugares usando Rutas Urbanas, Metro y Transmetro.
  Tu tono debe ser amable, útil y usar modismos locales ligeros (Ej. "camión", "feria", "qué onda") sin forzarlo.
  
  ${contextText}

  Si el usuario te pregunta cómo llegar a un sitio, proponle una o dos opciones de ruta claras.
  Si detectas que inició una ruta, hazle preguntas breves como "¿El camión va muy lleno?" para recopilar retroalimentación.

  HERRAMIENTA DE MAPA (draw_route):
  Tienes la capacidad de trazar las líneas del metro y ecovía en el mapa mediante la herramienta \`draw_route\`. Úsala SIEMPRE que sugieras estas rutas.
  
  RED DE METRÓREY Y ECOVÍA (Para que no te equivoques de línea):
  - Línea 1 (Amarilla) -> routeId: "metro-1". Va de Talleres a Exposición. Pasa por Mitras (Conexión Ecovía), Cuauhtémoc (Conexión L2), Félix U. Gómez (Conexión L3) y Parque Fundidora.
  - Línea 2 (Verde) -> routeId: "metro-2". Va de Sendero a Zaragoza. Pasa por Universidad, Regina (Conexión Ecovía), Cuauhtémoc (Conexión L1), Alameda y Padre Mier. (La Macroplaza está entre Padre Mier y Zaragoza).
  - Línea 3 (Naranja) -> routeId: "metro-3". Va de Zaragoza a Hospital Metropolitano. Pasa por Santa Lucía, Félix U. Gómez (Conexión L1) y Ruiz Cortines (Conexión Ecovía).
  - Ecovía (Roja) -> routeId: "ecovia". Va de Lincoln a Valle Soleado.

  REGLA MUY IMPORTANTE:
  Si la ruta requiere varios transportes (ej. tomar L2 y luego L1), DEBES llamar \`draw_route\` MÚLTIPLES VECES, una vez para cada línea que el usuario necesite tomar.
  En la PRIMERA llamada a draw_route, incluye origin y destination.
  En CADA llamada, incluye boardStation (donde se sube) y alightStation (donde se baja) para esa línea específica.
  Después de las llamadas a herramientas, da la explicación textual con los pasos detallados.
  `;


  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: systemPrompt,
    messages: await convertToModelMessages(messages) as any,
    tools: {
      draw_route: tool({
        description: 'Dibuja una línea de transporte en el mapa. Incluye estaciones de abordaje/descenso y opcionalmente el origen/destino del viaje.',
        parameters: z.object({
          routeId: z.enum(['metro-1', 'metro-2', 'metro-3', 'ecovia']).describe('ID de la ruta a dibujar'),
          boardStation: z.string().optional().describe('Estación donde el usuario aborda esta línea (ej. "Zaragoza")'),
          alightStation: z.string().optional().describe('Estación donde el usuario se baja de esta línea (ej. "Cuauhtémoc")'),
          origin: z.string().optional().describe('Lugar de origen del viaje completo (ej. "Macroplaza"). Solo en la primera llamada.'),
          destination: z.string().optional().describe('Destino final del viaje (ej. "Estadio BBVA"). Solo en la primera llamada.'),
        }),
        execute: async (args: any) => {
          console.log('[SERVER] draw_route EXECUTED:', args);
          return { ...args, status: `Ruta ${args.routeId} dibujada.` };
        },
      } as any),
    },
  });

  return result.toUIMessageStreamResponse();
};
