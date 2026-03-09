/**
 * Tiered Geocoding for Monterrey.
 *
 * Tier 1: knownPlaces.ts dictionary (instant, ~70 places)
 * Tier 2: In-memory cache (fast, survives requests within same process)
 * Tier 3: Nominatim OSM API (1 req/sec, scoped to Monterrey viewbox)
 *
 * Note: RAG (Supabase semantic search) is handled upstream by the LLM
 * to resolve ambiguous queries like "hospital más grande" → "Hospital Metropolitano"
 * before geocoding.
 */

import { resolveCoordinates } from '$lib/data/knownPlaces';

// ── In-memory cache ──
const geocodeCache = new Map<string, [number, number] | null>();

// ── Nominatim config ──
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const MONTERREY_VIEWBOX = '-100.5,25.5,-100.1,25.9'; // SW, NE of metro area

/**
 * Geocode a place name to [lng, lat] coordinates.
 * Returns null if the place cannot be resolved.
 */
export async function geocode(placeName: string): Promise<{
  coords: [number, number] | null;
  tier: 'local' | 'cache' | 'nominatim';
  raw?: string;
}> {
  const key = placeName.toLowerCase().trim();

  // Tier 1: Local dictionary
  const local = resolveCoordinates(placeName);
  if (local) {
    console.log(`[GEOCODING] Tier 1 (local): "${placeName}" → [${local}]`);
    return { coords: local, tier: 'local' };
  }

  // Tier 2: Cache
  if (geocodeCache.has(key)) {
    const cached = geocodeCache.get(key)!;
    console.log(`[GEOCODING] Tier 2 (cache): "${placeName}" → ${cached ? `[${cached}]` : 'null'}`);
    return { coords: cached, tier: 'cache' };
  }

  // Tier 3: Nominatim
  try {
    const params = new URLSearchParams({
      q: `${placeName}, Monterrey, Nuevo León, Mexico`,
      format: 'json',
      limit: '1',
      viewbox: MONTERREY_VIEWBOX,
      bounded: '1',
    });

    const response = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: {
        'User-Agent': 'RegioRuta/1.0 (transit-app)',
      },
    });

    if (!response.ok) {
      console.error(`[GEOCODING] Nominatim HTTP ${response.status} for "${placeName}"`);
      geocodeCache.set(key, null);
      return { coords: null, tier: 'nominatim' };
    }

    const results = await response.json();

    if (results.length > 0) {
      const { lon, lat, display_name } = results[0];
      const coords: [number, number] = [parseFloat(lon), parseFloat(lat)];
      geocodeCache.set(key, coords);
      console.log(`[GEOCODING] Tier 3 (nominatim): "${placeName}" → [${coords}] (${display_name})`);
      return { coords, tier: 'nominatim', raw: display_name };
    }

    console.warn(`[GEOCODING] Nominatim: no results for "${placeName}"`);
    geocodeCache.set(key, null);
    return { coords: null, tier: 'nominatim' };
  } catch (error) {
    console.error(`[GEOCODING] Nominatim error for "${placeName}":`, error);
    geocodeCache.set(key, null);
    return { coords: null, tier: 'nominatim' };
  }
}
