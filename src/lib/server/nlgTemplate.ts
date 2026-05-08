/**
 * Deterministic NLG templates — replace LLM for predictable, low-latency text.
 *
 * Used for:
 *   1. Route greeting after a successful plan (route/+server.ts)
 *   2. Chat reply when a routePlan is already attached (chat/+server.ts)
 *
 * Why no LLM here? The visual cards already describe each step. The text
 * just needs to acknowledge the plan briefly with local color — that does
 * not need a 600-1000ms LLM call.
 */

import { transitRoutes, type RouteId } from '$lib/data/transitRoutes';

export type Lang = 'es' | 'en';

interface Step {
  type: 'walk' | 'transit' | 'transfer';
  from?: string;
  to?: string;
  duration?: number;
  routeId?: RouteId | string;
  stopsCount?: number;
}

interface RoutePlanLike {
  origin: { name: string };
  destination: { name: string };
  totalDuration: number;
  steps: Step[];
}

interface AlternativeLike {
  totalDuration: number;
  steps: Step[];
}

// ── Greeting variants — picked deterministically by hash of inputs ──

const GREETINGS_ES = [
  '¡Ya estás!',
  'Simón, aquí va.',
  'De volon pin pon:',
  'En corto:',
  '¡Órale!',
  'Pos ándale:',
];

const GREETINGS_EN = [
  "Here's your trip:",
  'Got it.',
  'All set:',
  'Sure thing:',
];

// FNV-1a hash so the same input always picks the same greeting (testable).
function pickIndex(seed: string, modulo: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % modulo;
}

export function pickGreeting(seed: string, lang: Lang): string {
  const list = lang === 'en' ? GREETINGS_EN : GREETINGS_ES;
  return list[pickIndex(seed, list.length)];
}

// ── Public: greeting for a freshly-computed route ──

export function buildRouteGreeting(
  plan: RoutePlanLike,
  alternatives: AlternativeLike[],
  lang: Lang,
  hasTransportLeg: boolean,
): string {
  const seed = `${plan.origin.name}|${plan.destination.name}|${plan.totalDuration}`;
  const greeting = pickGreeting(seed, lang);

  if (lang === 'en') {
    let msg = `${greeting} Trip from **${plan.origin.name}** to **${plan.destination.name}** in ~${plan.totalDuration} min.`;
    if (alternatives.length > 0) {
      msg += ` ${alternatives.length} alternative${alternatives.length > 1 ? 's' : ''} available.`;
    }
    if (hasTransportLeg) {
      msg += '\n\n🚕 One leg is too far to walk — taxi, Uber or Didi recommended for that part.';
    }
    return msg;
  }

  let msg = `${greeting} Ruta de **${plan.origin.name}** a **${plan.destination.name}** en ~${plan.totalDuration} min.`;
  if (alternatives.length > 0) {
    msg += ` Tienes ${alternatives.length} alternativa${alternatives.length > 1 ? 's' : ''} también.`;
  }
  if (hasTransportLeg) {
    msg += '\n\n🚕 Un tramo está muy lejos para caminar — mejor pídete un taxi, Uber o Didi en esa parte.';
  }
  return msg;
}

// ── Public: full route description for the chat reply when routePlan is attached ──

function describeStep(s: Step, idx: number, lang: Lang): string {
  const n = idx + 1;
  if (s.type === 'walk') {
    return lang === 'en'
      ? `${n}. 🚶 Walk from "${s.from}" to "${s.to}" (~${s.duration} min)`
      : `${n}. 🚶 Caminar de "${s.from}" a "${s.to}" (~${s.duration} min)`;
  }
  if (s.type === 'transit') {
    let lineName: string;
    if (s.routeId === 'ecovia') {
      lineName = 'Ecovía';
    } else if (typeof s.routeId === 'string' && s.routeId.startsWith('ruta-')) {
      const route = transitRoutes[s.routeId as RouteId];
      lineName = route?.label?.replace(/ \((IDA|VUELTA)\)$/i, '') ?? s.routeId;
    } else if (typeof s.routeId === 'string' && s.routeId.startsWith('metro-')) {
      lineName = lang === 'en'
        ? `Metro Line ${s.routeId.split('-')[1]}`
        : `Metro Línea ${s.routeId.split('-')[1]}`;
    } else {
      lineName = String(s.routeId ?? '?');
    }
    return lang === 'en'
      ? `${n}. 🚇 Take ${lineName} from "${s.from}" to "${s.to}" (${s.stopsCount} stops, ~${s.duration} min)`
      : `${n}. 🚇 Tomar ${lineName} desde "${s.from}" hasta "${s.to}" (${s.stopsCount} paradas, ~${s.duration} min)`;
  }
  if (s.type === 'transfer') {
    return lang === 'en'
      ? `${n}. 🔄 Transfer at "${s.from}" (~${s.duration} min)`
      : `${n}. 🔄 Transbordo en "${s.from}" (~${s.duration} min)`;
  }
  return '';
}

// ── Public: friendly formatter for PlanError ──

interface PlanErrorLike {
  code: string;
  message: string;
  suggestion?: {
    nearestStation: string;
    stationCoords: [number, number];
    distanceKm: number;
    taxiMinutes: number;
    taxiCostMXN: number;
    routeId?: string;
  };
}

/**
 * Render a user-facing message for a PlanError. When the error carries a
 * suggestion (nearest station + taxi estimate), the copy turns it into an
 * actionable recommendation rather than a dead-end.
 */
export function formatPlanError(err: PlanErrorLike, lang: Lang = 'es'): string {
  const sg = err.suggestion;

  if (err.code === 'SAME_PLACE') {
    return lang === 'en' ? "You're already there!" : '¡Ya estás ahí!';
  }

  if (err.code === 'TOO_FAR' && sg) {
    if (lang === 'en') {
      return `That's ${sg.distanceKm} km from the nearest station (${sg.nearestStation}). ` +
        `Best bet: hop a taxi/Uber/Didi to ${sg.nearestStation} (~${sg.taxiMinutes} min, ~$${sg.taxiCostMXN} MXN), then continue by transit.`;
    }
    return `Está a ${sg.distanceKm} km de la estación más cercana (${sg.nearestStation}). ` +
      `Lo mejor: pídete taxi/Uber/Didi a ${sg.nearestStation} (~${sg.taxiMinutes} min, ~$${sg.taxiCostMXN} MXN) y de ahí síguele en transporte público.`;
  }

  if (err.code === 'NO_ROUTE') {
    return lang === 'en'
      ? "Couldn't find a public-transit route between those points. Try nearby landmarks instead."
      : 'No encontré una ruta de transporte público entre esos puntos. Prueba con un punto de referencia cercano.';
  }

  if (err.code === 'GEOCODE_ORIGIN') {
    return lang === 'en'
      ? "Couldn't find that origin. Could you be more specific?"
      : 'No encontré ese origen. ¿Podrías ser más específico?';
  }

  if (err.code === 'GEOCODE_DEST') {
    return lang === 'en'
      ? "Couldn't find that destination. Could you be more specific?"
      : 'No encontré ese destino. ¿Podrías ser más específico?';
  }

  if (err.code === 'MISSING_ORIGIN') {
    return lang === 'en'
      ? 'I need to know where you are starting from. Give me an origin or allow GPS.'
      : 'Necesito saber desde dónde sales. ¿Me das un origen, o permites el GPS?';
  }

  // Fallback: surface whatever message the error came with.
  return err.message;
}

export function buildRouteExplanation(plan: RoutePlanLike, lang: Lang = 'es'): string {
  const seed = `${plan.origin.name}|${plan.destination.name}|${plan.totalDuration}`;
  const greeting = pickGreeting(seed, lang);
  const header = lang === 'en'
    ? `${greeting} Trip from **${plan.origin.name}** to **${plan.destination.name}** in ~${plan.totalDuration} min.`
    : `${greeting} Ruta de **${plan.origin.name}** a **${plan.destination.name}** en ~${plan.totalDuration} min.`;
  const steps = plan.steps.map((s, i) => describeStep(s, i, lang)).filter(Boolean).join('\n');
  return `${header}\n\n${steps}`;
}
