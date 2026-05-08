/**
 * Natural Language Understanding for route queries.
 *
 * Two layers:
 *   1. fastNLU() — regex-based, <2ms, covers ~90% of common phrasings.
 *   2. (caller falls back to LLM) — for unrecognized patterns.
 *
 * Extracted from /api/route to enable unit testing.
 */

import { resolveCoordinates } from '$lib/data/knownPlaces';
import type { TransportType } from '$lib/engine/raptorData';

// ── Accent normalization ──
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Language detection — conservative, only fires on unambiguous English signals ──
// Spanish queries with English words ("llévame al downtown") must NOT trigger this.
export function detectLang(message: string): 'en' | 'es' {
  const m = message.toLowerCase();
  const enPhrases = [
    'how do i', 'how can i', 'how to get', 'how do you',
    'take me to', 'get me to', 'directions to', 'route to',
    'i want to go', 'i need to go', "i'm going to",
    'from the ', 'from downtown', 'from airport',
    'to the airport', 'to the stadium', 'to downtown',
    'get to ', 'going to ', 'way to ',
  ];
  return enPhrases.some(p => m.includes(p)) ? 'en' : 'es';
}

// ── Pre-compiled regexes for performance ──

// Pattern 1: "de/desde X a/hasta/hacia Y" (origin first)
// Greedy (.+) for origin so "de Plaza la Silla a Fundidora" splits at last "a"
const P1 = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+)?de(?:sde)?\s+(.+)\s+(?:a|hasta|hacia)\s+(.+?)[?.!]?\s*$/i;

// Pattern 2a: "VERB a/al Y desde X" (destination first, with origin)
// Article-aware variants come FIRST so "a la macroplaza" doesn't match bare "a" leaving "la" in the destination.
const P2A = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+(?:a\s+la|a\s+los|a\s+las|a\s+el|al|a)\s+(.+?)\s+desde\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 2b: "VERB a/al Y" (destination only, no origin)
const P2B = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?(?:como\s+(?:llego|ir|voy)|quiero\s+(?:ir|llegar)|necesito\s+ir|voy\s+a\s+ir|me\s+llevas?|llevame)\s+(?:a\s+la|a\s+los|a\s+las|a\s+el|al|a)\s+(.+?)[?.!]?\s*$/i;

// Pattern 3a: "ruta a Y desde X"
const P3A = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?ruta\s+(?:a\s+la|a\s+los|a\s+las|a\s+el|al|a)\s+(.+?)\s+desde\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 3b: "ruta a/al/hacia Y"
const P3B = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey|oiga|disculpa|disculpe|porfa|orale)[,;]?\s+)?ruta\s+(?:a\s+la|a\s+los|a\s+las|a\s+el|al|hacia|a)\s+(.+?)[?.!]?\s*$/i;

// ── Routes-near patterns ──

// Pattern 5: "qué rutas/camiones/lineas pasan por X"
const P5_ROUTES_NEAR = /^¿?\s*(?:(?:oye|mira|ey|hey|we|wey)[,;]?\s+)?(?:qu[eé]\s+)?(?:rutas?|cami[oó]n(?:es)?|l[ií]neas?|transporte)\s+(?:pasan?|hay|circulan?|sirven?|llegan?)\s+(?:cerca\s+del|cerca\s+de\s+la|cerca\s+de\s+los|cerca\s+de\s+las|cerca\s+de|del|por|en|a)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// Pattern 6: "qué metro/camión me deja cerca de X" (filtered by transport type)
// Accepts contractions: "del" = "de el". Article stripped after the preposition.
const P6_FILTERED = /^¿?\s*(?:qu[eé]\s+)?(metros?|cami[oó]n(?:es)?|ecov[ií]a|rutas?|l[ií]neas?\s+de\s+metro)\s+(?:me\s+)?(?:dejan?|llevan?|pasan?|sirven?)\s+(?:cerca\s+del|cerca\s+de\s+la|cerca\s+de\s+los|cerca\s+de\s+las|cerca\s+de|del|por|en|a|al|hasta)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)[?.!]?\s*$/i;

// ── NLU Result Types ──

export type NLURouteResult = { type: 'route'; origin?: string; destination: string };
export type NLURoutesNearResult = { type: 'routes-near'; location: string; filter?: TransportType };
export type NLUResult = NLURouteResult | NLURoutesNearResult | null;

export function parseTransportFilter(match: string): TransportType | undefined {
  const m = match.toLowerCase();
  if (m.includes('metro') || m.includes('línea de metro') || m.includes('linea de metro')) return 'metro';
  if (m.includes('ecovia') || m.includes('ecovía')) return 'ecovia';
  if (m.includes('camion') || m.includes('camión')) return 'bus';
  // 'ruta'/'rutas' are generic — no filter (show all transport types)
  return undefined;
}

export function fastNLU(message: string): NLUResult {
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

  return null; // fallback to LLM
}
