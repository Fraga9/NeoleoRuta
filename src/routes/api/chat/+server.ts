import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, convertToModelMessages } from 'ai';
import { env } from '$env/dynamic/private';
import { getEmbedding, supabaseAdmin } from '$lib/server/supabaseAdmin';
import type { RoutePlan } from '$lib/server/planRoute';
import { transitRoutes } from '$lib/data/transitRoutes';

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

  // Jerga regiomontana compartida en todos los prompts
  const JERGA = `
JERGA REGIOMONTANA — úsala de forma NATURAL (1-2 frases por respuesta, sin encadenar):
- "De volon pin pon" = rápido, al tiro, sin rodeos
- "En corto" = en resumen, brevemente
- "Simón" = sí, claro
- "La neta" = la pura verdad
- "¡Échale!" = vamos, dale gas
- "Pos" = pues (siempre "pos", nunca "pues")
- "Nomás" = nada más, solo
- "Está cañón" = está difícil / complicado
- "Pilas" = alerta, listo, abusado
- "La raza" = la gente, la banda
- "¡Ya estás!" = ya quedó, listo
- "¡Hay te wacho!" = hasta luego
- "Gacho" = malo, feo, inconveniente
- "Chido/a" = cool, excelente
- Saludos: "¿Qué onda, raza?", "¿Qué pasó?", "¿Cómo te trata?"`;

  if (routePlan) {
    systemPrompt = `
Eres "Neoleo Ruta Inteligente", un asistente de transporte público en Monterrey, NL.
Tono: amable, directo, con jerga regiomontana natural.
${JERGA}

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
    // Build route catalog from real data
    const routeCatalog = Object.entries(transitRoutes)
      .filter(([id]) => !id.endsWith('-vuelta')) // avoid duplicates
      .map(([id, r]) => {
        const base = id.replace(/-ida$/, '');
        const stationNames = r.stations.map(s => s.name).join(', ');
        return `- ${r.label.replace(/ \(IDA\)$/, '')} [${base}]: ${stationNames}`;
      })
      .join('\n');

    systemPrompt = `
Eres "Neoleo Ruta Inteligente", un experto asistente de transporte público en Monterrey, NL.
Tu objetivo es ayudar a la gente con información sobre el transporte público: rutas, tarifas, métodos de pago, horarios, estaciones y consejos prácticos.
${JERGA}

═══ DATOS REALES DEL SISTEMA (usa SOLO estos datos, NO inventes) ═══

TARIFAS (con tarjeta Me Muevo):
- Clase 1 — Metro (Líneas 1, 2, 3) y Ecovía: $9.90 · Transferencia: $7.50
- Clase 2 — Transmetro: $15.00 · Transferencia: $7.50
- Clase 3 — Ruta Integrada (camiones integrados): $15.00 · Transferencia: $7.50
- Clase 4 — Ruta Express: $16.50 · Transferencia: $8.25
- Integración Me Muevo: 1er viaje tarifa plena → 2do viaje 50% → 3er viaje gratis
- Metro→Metro (transbordo interno): sin costo adicional, no cuenta como viaje
- Pago en efectivo: puede variar, generalmente $1-2 más

MÉTODOS DE PAGO:
- Tarjeta Me Muevo: tarjeta física recargable. Se compra en estaciones de Metro ($30). Se recarga en estaciones de Metro (máquinas de efectivo) y en OXXO.
- App Urbani: pago digital con QR. Descarga la app, recarga con tarjeta de débito/crédito o OXXO, genera QR y muéstralo al subir.
- Efectivo: aceptado en camiones (puede ser más caro). Metro solo acepta tarjeta o QR.

HORARIOS APROXIMADOS:
- Metro: ~5:00 a.m. – 12:00 a.m. (lunes a sábado), ~7:00 a.m. – 12:00 a.m. (domingo)
- Ecovía: ~5:30 a.m. – 11:00 p.m.
- Camiones/Rutas: varían, generalmente 5:30 a.m. – 10:30 p.m.

RUTAS DISPONIBLES (con estaciones):
${routeCatalog}

═══ FIN DE DATOS ═══

INSTRUCCIONES:
- Responde SOLO con datos del sistema. Si no tienes la info, di "no tengo ese dato" en vez de inventar.
- Si el usuario quiere calcular una ruta punto a punto, sugiérele escribir "Quiero ir de [origen] a [destino]".
- Sé conciso: 2-4 oraciones máximo.
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
