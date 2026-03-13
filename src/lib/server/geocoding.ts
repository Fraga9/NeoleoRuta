/**
 * Tiered Geocoding for Monterrey.
 *
 * Tier 1: knownPlaces.ts dictionary (instant, ~200+ places)
 * Tier 2: In-memory cache (fast, survives requests within same process)
 * Tier 3: Nominatim structured query (for detected street addresses)
 * Tier 4: Nominatim free-text (scoped to Monterrey viewbox)
 * Tier 5: Photon fallback (fuzzy, lat/lon biased to Monterrey)
 *
 * When tiers 3-5 return multiple candidates spread >500m apart,
 * the result is 'ambiguous' and the caller triggers disambiguation.
 */

import { resolveCoordinates } from '$lib/data/knownPlaces';
import { haversineDistance } from '$lib/engine/raptorData';

// ── Types ──

export interface GeoCandidate {
  label: string;
  coords: [number, number];
}

export type GeoResult =
  | { status: 'resolved'; coords: [number, number]; label: string; tier: string }
  | { status: 'ambiguous'; candidates: GeoCandidate[] }
  | { status: 'not_found' };

// ── Config ──

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const PHOTON_BASE = 'https://photon.komoot.io/api';
const MONTERREY_VIEWBOX = '-100.5,25.5,-100.1,25.9';
const MTY_CENTER: [number, number] = [-100.31, 25.67];
const DISAMBIGUATION_THRESHOLD_M = 500;

// ── In-memory cache (only for resolved results) ──
const geocodeCache = new Map<string, { coords: [number, number]; label: string; tier: string }>();

// ── Address detection ──

/**
 * Detect if an input looks like a street address rather than a place name.
 * Three signals (any one is sufficient):
 * A. Explicit colonia mention (col./colonia)
 * B. Street prefix + name + house number
 * C. Word(≥3 chars) + house number (broad catch)
 */
export function detectAddress(input: string): boolean {
  const s = input.toLowerCase().trim();

  // Signal A: "col. Independencia", "colonia del valle"
  if (/\bcol(?:onia)?\.?\s+\w+/i.test(s)) return true;

  // Signal B: Street prefix + name + number
  if (/(?:^|[\s,])(?:calle|av\.?|avenida|blvd\.?|boulevard|r[ií]o|priv\.?|privada|paseo|calz\.?|calzada|carr\.?|carretera|andador|cerrada|retorno)\s+[\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+)*\s+#?\d{1,5}\b/i.test(s)) return true;

  // Signal C: word≥3 + house number (catches "Hidalgo 102", "Madero 500")
  if (/(?:^|[\s,])[\w\u00C0-\u024F]{3,}(?:\s+[\w\u00C0-\u024F]+)*\s+#?\d{1,5}(?:\s*,|\s*$)/i.test(s)) return true;

  return false;
}

// ── Nominatim structured query ──

function parseAddressParts(input: string): { street: string; neighborhood?: string } {
  const s = input.trim();

  // Try to extract "colonia" / "col." portion
  const colMatch = s.match(/[,;]\s*col(?:onia)?\.?\s+(.+?)$/i);
  if (colMatch) {
    const street = s.slice(0, colMatch.index!).trim();
    return { street, neighborhood: colMatch[1].trim() };
  }

  return { street: s };
}

async function nominatimStructured(input: string): Promise<GeoCandidate[]> {
  const { street, neighborhood } = parseAddressParts(input);

  // Include neighborhood in the street field (Nominatim's county= maps to municipio,
  // not colonia). Appending "colonia X" to the street field improves matching.
  const streetWithNeighborhood = neighborhood ? `${street}, ${neighborhood}` : street;

  const params = new URLSearchParams({
    street: streetWithNeighborhood,
    city: 'Monterrey',
    state: 'Nuevo León',
    country: 'Mexico',
    format: 'json',
    limit: '5',
    viewbox: MONTERREY_VIEWBOX,
    bounded: '1',
  });

  try {
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': 'RegioRuta/1.0 (transit-app)' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((r: any) => ({
      label: r.display_name?.split(',').slice(0, 3).join(',').trim() || r.display_name,
      coords: [parseFloat(r.lon), parseFloat(r.lat)] as [number, number],
    }));
  } catch {
    return [];
  }
}

// ── Nominatim free-text ──

async function nominatimFreeText(input: string): Promise<GeoCandidate[]> {
  const params = new URLSearchParams({
    q: `${input}, Monterrey, Nuevo León, Mexico`,
    format: 'json',
    limit: '5',
    viewbox: MONTERREY_VIEWBOX,
    bounded: '1',
  });

  try {
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': 'RegioRuta/1.0 (transit-app)' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((r: any) => ({
      label: r.display_name?.split(',').slice(0, 3).join(',').trim() || r.display_name,
      coords: [parseFloat(r.lon), parseFloat(r.lat)] as [number, number],
    }));
  } catch {
    return [];
  }
}

// ── Photon fallback ──

async function photonGeocode(input: string): Promise<GeoCandidate[]> {
  const params = new URLSearchParams({
    q: input,
    lat: MTY_CENTER[1].toString(),
    lon: MTY_CENTER[0].toString(),
    limit: '5',
    lang: 'es',
  });

  try {
    const res = await fetch(`${PHOTON_BASE}?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.features) return [];

    // Filter to Monterrey metro bounding box
    return data.features
      .filter((f: any) => {
        const [lon, lat] = f.geometry.coordinates;
        return lon >= -100.5 && lon <= -100.1 && lat >= 25.5 && lat <= 25.9;
      })
      .map((f: any) => {
        const p = f.properties;
        // Deduplicate parts (name and street can be identical for address results)
        const parts = [...new Set([p.name, p.street, p.locality, p.city].filter(Boolean))];
        return {
          label: parts.slice(0, 3).join(', ') || p.name || input,
          coords: f.geometry.coordinates as [number, number],
        };
      });
  } catch {
    return [];
  }
}

// ── Candidate processing ──

/**
 * Max pairwise haversine distance among candidates.
 * Used to decide if disambiguation is needed.
 */
function maxCandidateSpread(candidates: GeoCandidate[]): number {
  let maxDist = 0;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const d = haversineDistance(candidates[i].coords, candidates[j].coords);
      if (d > maxDist) maxDist = d;
    }
  }
  return maxDist;
}

/**
 * Deduplicate candidates that are very close to each other.
 * Same-label candidates use a wider threshold (500m) since they look
 * identical to the user (e.g. different segments of the same street).
 */
function deduplicateCandidates(candidates: GeoCandidate[]): GeoCandidate[] {
  const result: GeoCandidate[] = [];
  for (const c of candidates) {
    const isDupe = result.some(r => {
      const dist = haversineDistance(r.coords, c.coords);
      const sameLabel = r.label === c.label;
      return dist < (sameLabel ? 500 : 100);
    });
    if (!isDupe) result.push(c);
  }
  return result;
}

/**
 * Process a candidate list: deduplicate, then resolve or mark ambiguous.
 */
function processCandidates(candidates: GeoCandidate[], tier: string): GeoResult | null {
  const deduped = deduplicateCandidates(candidates);
  if (deduped.length === 0) return null;

  if (deduped.length === 1 || maxCandidateSpread(deduped) <= DISAMBIGUATION_THRESHOLD_M) {
    // All candidates are close together — auto-select first
    return { status: 'resolved', coords: deduped[0].coords, label: deduped[0].label, tier };
  }

  // Multiple candidates spread >500m apart — disambiguation needed
  return { status: 'ambiguous', candidates: deduped };
}

// ── Main entry point ──

/**
 * Multi-tier geocoding with disambiguation support.
 * Returns resolved coords, ambiguous candidates, or not_found.
 */
export async function geocodeMulti(placeName: string): Promise<GeoResult> {
  const key = placeName.toLowerCase().trim();

  // Tier 1: Local dictionary (knownPlaces)
  const local = resolveCoordinates(placeName);
  if (local) {
    console.log(`[GEOCODING] Tier 1 (local): "${placeName}" → [${local}]`);
    return { status: 'resolved', coords: local, label: placeName, tier: 'local' };
  }

  // Tier 2: Cache (resolved results only)
  const cached = geocodeCache.get(key);
  if (cached) {
    console.log(`[GEOCODING] Tier 2 (cache): "${placeName}" → [${cached.coords}]`);
    return { status: 'resolved', ...cached };
  }

  // Tier 3: Nominatim structured (only for detected addresses)
  const isAddress = detectAddress(placeName);
  if (isAddress) {
    console.log(`[GEOCODING] Tier 3 (structured): detected address "${placeName}"`);
    const candidates = await nominatimStructured(placeName);
    const result = processCandidates(candidates, 'nominatim-structured');
    if (result) {
      if (result.status === 'resolved') geocodeCache.set(key, result);
      return result;
    }
  }

  // Tier 4: Nominatim free-text
  console.log(`[GEOCODING] Tier 4 (nominatim): "${placeName}"`);
  const freeTextCandidates = await nominatimFreeText(placeName);
  const freeTextResult = processCandidates(freeTextCandidates, 'nominatim');
  if (freeTextResult) {
    if (freeTextResult.status === 'resolved') geocodeCache.set(key, freeTextResult);
    return freeTextResult;
  }

  // Tier 5: Photon fallback
  console.log(`[GEOCODING] Tier 5 (photon): "${placeName}"`);
  const photonCandidates = await photonGeocode(placeName);
  const photonResult = processCandidates(photonCandidates, 'photon');
  if (photonResult) {
    if (photonResult.status === 'resolved') geocodeCache.set(key, photonResult);
    return photonResult;
  }

  console.warn(`[GEOCODING] All tiers failed for "${placeName}"`);
  return { status: 'not_found' };
}

// ── Backward-compatible wrapper ──

/**
 * Legacy geocode function — wraps geocodeMulti for existing call sites.
 * Returns first resolved candidate or null. Ambiguous results return first candidate.
 */
export async function geocode(placeName: string): Promise<{
  coords: [number, number] | null;
  tier: string;
  raw?: string;
}> {
  const result = await geocodeMulti(placeName);
  if (result.status === 'resolved') {
    return { coords: result.coords, tier: result.tier };
  }
  if (result.status === 'ambiguous') {
    // Legacy behavior: pick first candidate
    return { coords: result.candidates[0].coords, tier: 'nominatim' };
  }
  return { coords: null, tier: 'not_found' };
}
