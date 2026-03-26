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

// Ambiguous terms that should skip Tier 1 (local dictionary) and go directly to external geocoders
// These are acronyms or chains with multiple locations that Nominatim handles better
const REQUIRES_EXTERNAL_GEOCODING = new Set([
  'sat', 'imss', 'issste', 'infonavit', 'cfe', 'telmex',
  'oxxo', 'heb', '7eleven', '7-eleven', 'soriana', 'walmart',
  'coppel', 'elektra', 'famsa', 'banco', 'banamex', 'bancomer', 'banorte',
]);
const PHOTON_BASE = 'https://photon.komoot.io/api';
const MONTERREY_VIEWBOX = '-100.5,25.5,-100.1,25.9';
const MTY_CENTER: [number, number] = [-100.31, 25.67];
const DISAMBIGUATION_THRESHOLD_M = 500;

// ── In-memory cache (only for resolved results) ──
const geocodeCache = new Map<string, { coords: [number, number]; label: string; tier: string }>();

// ── Address detection ──

export interface AddressDetection {
  isAddress: boolean;
  isColoniaOnly?: boolean;  // Colonia without street number (e.g., "colonia san francisco")
}

/**
 * Detect if an input looks like a street address rather than a place name.
 * Three signals (any one is sufficient):
 * A. Explicit colonia mention (col./colonia) - may be colonia-only (no number)
 * B. Street prefix + name + house number
 * C. Word(≥3 chars) + house number (broad catch)
 */
export function detectAddress(input: string): AddressDetection {
  const s = input.toLowerCase().trim();

  // Signal A: "col. Independencia", "colonia del valle"
  if (/\bcol(?:onia)?\.?\s+\w+/i.test(s)) {
    // Check if there's a house number anywhere in the string
    const hasNumber = /\d{1,5}/.test(s);
    return { isAddress: true, isColoniaOnly: !hasNumber };
  }

  // Signal B: Street prefix + name + number
  if (/(?:^|[\s,])(?:calle|av\.?|avenida|blvd\.?|boulevard|r[ií]o|priv\.?|privada|paseo|calz\.?|calzada|carr\.?|carretera|andador|cerrada|retorno)\s+[\w\u00C0-\u024F]+(?:\s+[\w\u00C0-\u024F]+)*\s+#?\d{1,5}\b/i.test(s)) {
    return { isAddress: true };
  }

  // Signal C: word≥3 + house number (catches "Hidalgo 102", "Madero 500")
  if (/(?:^|[\s,])[\w\u00C0-\u024F]{3,}(?:\s+[\w\u00C0-\u024F]+)*\s+#?\d{1,5}(?:\s*,|\s*$)/i.test(s)) {
    return { isAddress: true };
  }

  return { isAddress: false };
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
    state: 'Nuevo León',
    country: 'Mexico',
    format: 'json',
    limit: '10',
    viewbox: MONTERREY_VIEWBOX,
    bounded: '1',
  });

  try {
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': 'NeoleoRuta/1.0 (transit-app)' },
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

// ── Nominatim colonia (neighbourhood/settlement) ──

async function nominatimColonia(input: string): Promise<GeoCandidate[]> {
  // Strip "colonia"/"col." prefix so Nominatim gets just the neighbourhood name
  const name = input.replace(/^\s*col(?:onia)?\.?\s+/i, '').trim();

  // Two parallel queries: with and without "colonia" prefix, both as settlement
  const queries = [name, `colonia ${name}`];
  const allResults: GeoCandidate[] = [];

  for (const q of queries) {
    const params = new URLSearchParams({
      q: `${q}, Monterrey, Nuevo León, Mexico`,
      format: 'json',
      limit: '5',
      viewbox: MONTERREY_VIEWBOX,
      bounded: '1',
      featuretype: 'settlement',  // Only return suburbs/neighbourhoods, not streets
    });

    try {
      const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
        headers: { 'User-Agent': 'NeoleoRuta/1.0 (transit-app)' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      allResults.push(...data.map((r: any) => ({
        label: r.display_name?.split(',').slice(0, 3).join(',').trim() || r.display_name,
        coords: [parseFloat(r.lon), parseFloat(r.lat)] as [number, number],
      })));
    } catch { /* ignore */ }
  }

  return allResults;
}

// ── Nominatim free-text ──

async function nominatimFreeText(input: string): Promise<GeoCandidate[]> {
  // Build query list: original + number-stripped variant to find all matching streets
  const queries = [input];
  const stripped = input.replace(/\s*#?\d{1,5}\s*$/, '').trim();
  if (stripped !== input && stripped.length > 2) {
    queries.push(stripped);
  }

  const allResults: GeoCandidate[] = [];

  // Sequential to respect Nominatim's rate limits
  for (const q of queries) {
    const params = new URLSearchParams({
      q: `${q}, Nuevo León, Mexico`,
      format: 'json',
      limit: '10',
      viewbox: MONTERREY_VIEWBOX,
      bounded: '1',
    });

    try {
      const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
        headers: { 'User-Agent': 'NeoleoRuta/1.0 (transit-app)' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      allResults.push(...data.map((r: any) => ({
        label: r.display_name?.split(',').slice(0, 3).join(',').trim() || r.display_name,
        coords: [parseFloat(r.lon), parseFloat(r.lat)] as [number, number],
      })));
    } catch { /* ignore */ }
  }

  return allResults;
}

// ── Photon fallback ──

async function photonGeocode(input: string): Promise<GeoCandidate[]> {
  // Build query list: original + number-stripped variant to find all matching streets
  const queries = [input];
  const stripped = input.replace(/\s*#?\d{1,5}\s*$/, '').trim();
  if (stripped !== input && stripped.length > 2) {
    queries.push(stripped);
  }

  const allFeatures: any[] = [];

  await Promise.all(queries.map(async (q) => {
    const params = new URLSearchParams({
      q,
      lat: MTY_CENTER[1].toString(),
      lon: MTY_CENTER[0].toString(),
      limit: '10',
    });

    try {
      const res = await fetch(`${PHOTON_BASE}?${params}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.features) allFeatures.push(...data.features);
    } catch { /* ignore */ }
  }));

  // Filter to Monterrey metro bounding box + build candidates
  return allFeatures
    .filter((f: any) => {
      const [lon, lat] = f.geometry.coordinates;
      return lon >= -100.5 && lon <= -100.1 && lat >= 25.5 && lat <= 25.9;
    })
    .map((f: any) => {
      const p = f.properties;
      const parts = [...new Set([p.name, p.street, p.locality, p.city].filter(Boolean))];
      return {
        label: parts.slice(0, 3).join(', ') || p.name || input,
        coords: f.geometry.coordinates as [number, number],
      };
    });
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
    const dupeOf = result.find(r => {
      const dist = haversineDistance(r.coords, c.coords);
      const sameLabel = r.label === c.label;
      return dist < (sameLabel ? 1000 : 100);
    });
    if (dupeOf) {
      console.log(`[GEOCODING] Dedup: "${c.label}" (${Math.round(haversineDistance(dupeOf.coords, c.coords))}m from "${dupeOf.label}")`);
    } else {
      result.push(c);
    }
  }
  return result;
}

/**
 * Process a candidate list: deduplicate, sort by proximity, then resolve or mark ambiguous.
 * @param sortByRef - reference point for sorting (user GPS or city center). Closest first.
 */
function processCandidates(candidates: GeoCandidate[], tier: string, sortByRef?: [number, number]): GeoResult | null {
  console.log(`[GEOCODING] ${tier} raw candidates (${candidates.length}):`);
  candidates.forEach((c, i) => {
    console.log(`  [${i}] "${c.label}" → [${c.coords[0].toFixed(5)}, ${c.coords[1].toFixed(5)}]`);
  });

  const deduped = deduplicateCandidates(candidates);

  if (deduped.length < candidates.length) {
    console.log(`[GEOCODING] After dedup: ${candidates.length} → ${deduped.length}`);
    deduped.forEach((c, i) => {
      console.log(`  [${i}] "${c.label}" → [${c.coords[0].toFixed(5)}, ${c.coords[1].toFixed(5)}]`);
    });
  }

  if (deduped.length === 0) return null;

  const spread = maxCandidateSpread(deduped);
  console.log(`[GEOCODING] Spread: ${Math.round(spread)}m (threshold: ${DISAMBIGUATION_THRESHOLD_M}m), count: ${deduped.length}`);

  if (deduped.length === 1 || spread <= DISAMBIGUATION_THRESHOLD_M) {
    console.log(`[GEOCODING] Auto-resolved: "${deduped[0].label}"`);
    return { status: 'resolved', coords: deduped[0].coords, label: deduped[0].label, tier };
  }

  // Multiple candidates spread >500m apart — disambiguation needed
  // Sort by distance to reference point (closest first) so the most relevant option is at the top
  if (sortByRef) {
    deduped.sort((a, b) =>
      haversineDistance(a.coords, sortByRef) - haversineDistance(b.coords, sortByRef)
    );
    console.log(`[GEOCODING] Sorted ${deduped.length} candidates by distance to [${sortByRef[0].toFixed(4)}, ${sortByRef[1].toFixed(4)}]`);
  }

  return { status: 'ambiguous', candidates: deduped };
}

// ── Main entry point ──

/**
 * Multi-tier geocoding with disambiguation support.
 * Returns resolved coords, ambiguous candidates, or not_found.
 */
export async function geocodeMulti(placeName: string, userLocation?: [number, number]): Promise<GeoResult> {
  const key = placeName.toLowerCase().trim();

  // Skip Tier 1 for ambiguous terms (chains, government offices with multiple locations)
  const skipLocalLookup = REQUIRES_EXTERNAL_GEOCODING.has(key);
  
  if (!skipLocalLookup) {
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
  } else {
    console.log(`[GEOCODING] Skipping Tier 1 for ambiguous term: "${placeName}"`);
  }

  // Tiers 3+4+5: Collect candidates from all external geocoders, then process once.
  // This ensures a structured match (Tier 3) doesn't short-circuit before
  // free-text/Photon can find the same street in other municipalities.
  const addressInfo = detectAddress(placeName);

  const geocodePromises: Promise<GeoCandidate[]>[] = [];

  // Only use structured query for addresses with street numbers, not colonia-only queries
  // Colonia-only (e.g., "colonia san francisco") doesn't have a number, so structured query
  // sends street="colonia san francisco" which fails - let free-text handle it
  if (addressInfo.isAddress && !addressInfo.isColoniaOnly) {
    console.log(`[GEOCODING] Tier 3 (structured): detected address "${placeName}"`);
    geocodePromises.push(nominatimStructured(placeName));
  } else if (addressInfo.isColoniaOnly) {
    // Use settlement-scoped query to get the neighbourhood centroid, not streets
    console.log(`[GEOCODING] Colonia-only query: "${placeName}" → settlement search`);
    geocodePromises.push(nominatimColonia(placeName));
  }

  console.log(`[GEOCODING] Tier 4+5 (nominatim + photon): "${placeName}"`);
  geocodePromises.push(nominatimFreeText(placeName));
  geocodePromises.push(photonGeocode(placeName));

  const allResults = await Promise.all(geocodePromises);
  const allCandidates = allResults.flat();

  const sortRef = userLocation || MTY_CENTER;
  const tierLabel = addressInfo.isColoniaOnly ? 'nominatim+photon (colonia)' 
                  : addressInfo.isAddress ? 'structured+nominatim+photon' 
                  : 'nominatim+photon';
  const mergedResult = processCandidates(allCandidates, tierLabel, sortRef);
  if (mergedResult) {
    if (mergedResult.status === 'resolved') geocodeCache.set(key, mergedResult);
    return mergedResult;
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
