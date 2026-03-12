/**
 * OSRM Integration — real street-level distances using
 * the free OSRM demo server (Open Source Routing Machine).
 *
 * IMPORTANT: The OSRM demo server's 'foot' profile often returns
 * car-speed durations for Mexico. We use OSRM for DISTANCE only
 * and compute walking time ourselves at 80 m/min (4.8 km/h).
 */

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

const WALK_SPEED = 80;        // meters per minute (4.8 km/h)
const MAX_WALK_METERS = 2000; // walk up to 2km, beyond that → taxi/bus
const TAXI_SPEED = 400;       // meters per minute (~24 km/h city average)

// ── In-memory OSRM cache (coordinate pair → result) ──
const osrmCache = new Map<string, { distance: number; geometry: GeoJSON.LineString }>();

function cacheKey(from: [number, number], to: [number, number]): string {
  // Round to 5 decimal places (~1m precision) for cache hits
  const r = (n: number) => n.toFixed(5);
  return `${r(from[0])},${r(from[1])}|${r(to[0])},${r(to[1])}`;
}

export interface RouteSegment {
  distance: number;     // meters (real street distance)
  minutes: number;      // calculated duration
  mode: 'walk' | 'transport';  // walk if ≤2km, transport (taxi/bus) if >2km
  geometry?: GeoJSON.LineString;  // actual path geometry
}

/**
 * Get real street-level distance between two points using OSRM.
 * Returns null if OSRM fails.
 */
async function osrmDistance(
  from: [number, number],
  to: [number, number],
  profile: 'foot' | 'car' = 'foot'
): Promise<{ distance: number; geometry: GeoJSON.LineString } | null> {
  // Check cache first
  const key = cacheKey(from, to);
  const cached = osrmCache.get(key);
  if (cached) {
    console.log(`[OSRM] Cache hit: ${key.slice(0, 30)}...`);
    return cached;
  }

  try {
    const url = `${OSRM_BASE}/${profile}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'RegioRuta/1.0' },
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      console.warn(`[OSRM] HTTP ${response.status} for ${profile} request`);
      return null;
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) {
      console.warn(`[OSRM] API error: ${data.code}, message: ${data.message || 'none'}`);
      return null;
    }

    const result = {
      distance: data.routes[0].distance,  // meters (accurate)
      geometry: data.routes[0].geometry,   // GeoJSON LineString
    };
    osrmCache.set(key, result);
    return result;
  } catch (e) {
    console.warn(`[OSRM] Fetch error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Get route segment between two points.
 * Uses OSRM for real distance, our own speed for duration.
 * Returns walk (≤2km) or transport/taxi (>2km).
 */
export async function getRouteSegment(
  from: [number, number],
  to: [number, number]
): Promise<RouteSegment> {
  // Try OSRM for real street distance
  const osrm = await osrmDistance(from, to, 'foot');

  if (osrm) {
    const isWalkable = osrm.distance <= MAX_WALK_METERS;
    const speed = isWalkable ? WALK_SPEED : TAXI_SPEED;
    const minutes = Math.ceil(osrm.distance / speed);

    console.log(`[OSRM] ${isWalkable ? '🚶' : '🚕'} ${Math.round(osrm.distance)}m → ${minutes} min (${isWalkable ? 'walk' : 'transport'})`);

    return {
      distance: Math.round(osrm.distance),
      minutes,
      mode: isWalkable ? 'walk' : 'transport',
      geometry: osrm.geometry,
    };
  }

  // Fallback: Haversine × 1.3
  const haversineDist = haversine(from, to) * 1.3;
  const isWalkable = haversineDist <= MAX_WALK_METERS;
  const speed = isWalkable ? WALK_SPEED : TAXI_SPEED;
  const minutes = Math.ceil(haversineDist / speed);

  console.log(`[OSRM] Fallback: ${Math.round(haversineDist)}m → ${minutes} min (${isWalkable ? 'walk' : 'transport'})`);

  return {
    distance: Math.round(haversineDist),
    minutes,
    mode: isWalkable ? 'walk' : 'transport',
  };
}

/**
 * Get OSRM-based distances from a point to multiple stations.
 * Returns sorted by real distance (closest first).
 * Used to find the ACTUAL nearest station (not Haversine).
 */
export async function rankStationsByRealDistance(
  from: [number, number],
  stations: Array<{ id: string; coords: [number, number] }>
): Promise<Array<{ id: string; distance: number; minutes: number; mode: 'walk' | 'transport' }>> {
  // Call OSRM for all stations in parallel (batched)
  const results = await Promise.all(
    stations.map(async (station) => {
      const segment = await getRouteSegment(from, station.coords);
      return {
        id: station.id,
        distance: segment.distance,
        minutes: segment.minutes,
        mode: segment.mode,
      };
    })
  );

  // Sort by distance
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

function haversine(c1: [number, number], c2: [number, number]): number {
  const R = 6371000;
  const dLat = (c2[1] - c1[1]) * Math.PI / 180;
  const dLng = (c2[0] - c1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(c1[1] * Math.PI / 180) * Math.cos(c2[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
