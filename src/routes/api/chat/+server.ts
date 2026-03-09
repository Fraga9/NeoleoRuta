import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';
import { env } from '$env/dynamic/private';
import { getEmbedding, supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { RoutePlan } from '$lib/server/planRoute';

const google = createGoogleGenerativeAI({
  apiKey: env.GEMINI_API_KEY || '',
});

export const POST = async ({ request }: { request: Request }) => {
  const { messages, routePlan } = await request.json() as {
    messages: any[];
    routePlan?: RoutePlan | null;
  };

  // ── Extract last user message ──
  const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
  const lastUserMessage = lastUserMsg?.parts?.find((p: any) => p.type === 'text')?.text
    ?? lastUserMsg?.content
    ?? '';

  // ── RAG context (for enriched responses) ──
  let contextText = '';
  if (lastUserMessage) {
    try {
      const embedding = await getEmbedding(lastUserMessage);
      const { data: matchedLocations, error } = await supabaseAdmin.rpc('match_locations', {
        query_embedding: embedding,
        match_threshold: 0.7,
        match_count: 3,
      });
      if (!error && matchedLocations?.length > 0) {
        contextText = 'CONTEXTO DE LUGARES RELEVANTES:\n' +
          matchedLocations.map((l: any) => `- ${l.name} (${l.category}): ${l.description}`).join('\n');
      }
    } catch (e) {
      console.error('[RAG] Error:', e);
    }
  }

  // ── Build system prompt based on route plan (received from client) ──
  let systemPrompt: string;

  if (routePlan) {
    systemPrompt = `
Eres "RegioRuta Inteligente", un asistente de transporte público en Monterrey, NL.
Tu tono: amable, útil, con modismos locales ligeros ("camión", "feria", "qué onda").

Se ha calculado automáticamente la siguiente ruta. Tu ÚNICA tarea es explicarla de forma clara y amigable.
NO inventes rutas diferentes. NO cambies las líneas ni estaciones. Solo describe lo que viene abajo.

RUTA CALCULADA:
- Origen: ${routePlan.origin.name}
- Destino: ${routePlan.destination.name}
- Tiempo total estimado: ${routePlan.totalDuration} minutos
- Pasos:
${routePlan.steps.map((s: any, i: number) => {
  if (s.type === 'walk') return `  ${i + 1}. 🚶 Caminar de "${s.from}" a "${s.to}" (~${s.duration} min)`;
  if (s.type === 'transit') return `  ${i + 1}. 🚇 Tomar ${s.routeId === 'ecovia' ? 'Ecovía' : `Metro Línea ${s.routeId?.split('-')[1]}`} desde "${s.from}" hasta "${s.to}" (${s.stopsCount} paradas, ~${s.duration} min)`;
  if (s.type === 'transfer') return `  ${i + 1}. 🔄 Transbordo en "${s.from}" (~${s.duration} min)`;
  return '';
}).join('\n')}

${contextText}
`;
  } else {
    systemPrompt = `
Eres "RegioRuta Inteligente", un experto asistente de transporte público en Monterrey, NL.
Tu objetivo es ayudar a la gente a llegar a distintos lugares usando Rutas Urbanas, Metro y Transmetro.
Tu tono: amable, útil, con modismos locales ligeros ("camión", "feria", "qué onda") sin forzarlo.

Si el usuario pregunta cómo llegar a un sitio y no se ha calculado una ruta, pídele que use el formato
"Quiero ir de [origen] a [destino]" para calcular la mejor ruta automáticamente.
${contextText}
`;
  }

  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: systemPrompt,
    messages: await convertToModelMessages(messages) as any,
  });

  return result.toUIMessageStreamResponse();
};
