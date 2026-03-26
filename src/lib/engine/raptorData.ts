/**
 * RAPTOR Data Structures — preprocesses transitRoutes into
 * structures optimized for the RAPTOR algorithm.
 *
 * Built once at startup. No external API calls.
 */

import { transitRoutes, type RouteId, type Station } from '$lib/data/transitRoutes';

// ── Types ──

export interface RaptorStop {
  id: string;                    // "metro-1:Cuauhtémoc"
  name: string;
  coords: [number, number];
  routes: RouteId[];             // routes that serve this stop
}

export interface RaptorRouteData {
  id: RouteId;                   // original RouteId (for frontend compatibility)
  label: string;
  color: string;
  stops: string[];               // stop IDs in order of travel
  travelTimes: number[];         // minutes between consecutive stops (length = stops.length - 1)
}

export interface RaptorTransfer {
  fromStop: string;
  toStop: string;
  walkMinutes: number;
}

export interface AccessStop {
  stopId: string;
  walkMinutes: number;
  walkDistance: number;           // meters (Haversine × 1.4)
  mode: 'walk' | 'transport';
}

export interface RaptorInstance {
  stops: Map<string, RaptorStop>;
  routes: RaptorRouteData[];
  transfers: RaptorTransfer[];
  routesByStop: Map<string, number[]>;  // stopId → indices into routes[]
  transfersByStop: Map<string, RaptorTransfer[]>;  // stopId → outgoing transfers
}

// ── Constants ──

// Average speeds by route type (meters per minute)
const SPEED: Record<string, number> = {
  metro: 583,    // ~35 km/h
  ecovia: 417,   // ~25 km/h (BRT)
  bus: 300,      // ~18 km/h
};

const TRANSFER_PENALTY = 5; // minutes

const WALK_SPEED = 80;      // m/min (4.8 km/h)
const TAXI_SPEED = 400;     // m/min (~24 km/h)

// Haversine thresholds (raw, before ×1.4 detour factor)
const MAX_HAVERSINE_WALK = 1430;       // ×1.4 ≈ 2000m real
const MAX_HAVERSINE_TRANSPORT = 2500;  // ×1.4 ≈ 3500m real

const DETOUR_FACTOR = 1.4;

// ── Haversine ──

export function haversineDistance(
  c1: [number, number],
  c2: [number, number]
): number {
  const R = 6371000;
  const dLat = toRad(c2[1] - c1[1]);
  const dLng = toRad(c2[0] - c1[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(c1[1])) * Math.cos(toRad(c2[1])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Speed lookup ──

function getSpeed(routeId: RouteId): number {
  if (routeId.startsWith('metro-')) return SPEED.metro;
  if (routeId === 'ecovia') return SPEED.ecovia;
  return SPEED.bus;
}

// ── Stop ID helper ──

function stopId(routeId: RouteId, stationName: string): string {
  return `${routeId}:${stationName}`;
}

// ── Build RAPTOR Data ──

export function buildRaptorData(): RaptorInstance {
  const stops = new Map<string, RaptorStop>();
  const routes: RaptorRouteData[] = [];
  const transfers: RaptorTransfer[] = [];
  const routesByStop = new Map<string, number[]>();

  // Pass 1: Create stops and routes
  for (const [routeId, route] of Object.entries(transitRoutes) as [RouteId, typeof transitRoutes[RouteId]][]) {
    const isBidirectional = !routeId.startsWith('ruta-');
    const speed = getSpeed(routeId);

    // Build stop IDs and travel times for this route
    const routeStopIds: string[] = [];
    const travelTimes: number[] = [];

    for (let i = 0; i < route.stations.length; i++) {
      const station = route.stations[i];
      const sid = stopId(routeId, station.name);

      // Create or update stop
      if (!stops.has(sid)) {
        stops.set(sid, {
          id: sid,
          name: station.name,
          coords: station.coordinates,
          routes: [routeId],
        });
      } else {
        const existing = stops.get(sid)!;
        if (!existing.routes.includes(routeId)) {
          existing.routes.push(routeId);
        }
      }

      routeStopIds.push(sid);

      // Travel time to next stop (distance-based)
      if (i < route.stations.length - 1) {
        const dist = haversineDistance(station.coordinates, route.stations[i + 1].coordinates);
        const minutes = Math.max(1, Math.round(dist / speed));
        travelTimes.push(minutes);
      }
    }

    // Forward direction
    const forwardIdx = routes.length;
    routes.push({
      id: routeId,
      label: route.label,
      color: route.color,
      stops: routeStopIds,
      travelTimes,
    });

    // Register route index for each stop
    for (const sid of routeStopIds) {
      if (!routesByStop.has(sid)) routesByStop.set(sid, []);
      routesByStop.get(sid)!.push(forwardIdx);
    }

    // Reverse direction (only for metro/ecovía — bidirectional)
    if (isBidirectional) {
      const reverseStops = [...routeStopIds].reverse();
      const reverseTimes = [...travelTimes].reverse();
      const reverseIdx = routes.length;

      routes.push({
        id: routeId,  // same RouteId for frontend compatibility
        label: route.label,
        color: route.color,
        stops: reverseStops,
        travelTimes: reverseTimes,
      });

      for (const sid of reverseStops) {
        if (!routesByStop.has(sid)) routesByStop.set(sid, []);
        routesByStop.get(sid)!.push(reverseIdx);
      }
    }
  }

  // Pass 2: Build transfers from station.transfer[] fields
  const transferSet = new Set<string>(); // deduplicate "A→B" and "B→A"

  for (const [routeId, route] of Object.entries(transitRoutes) as [RouteId, typeof transitRoutes[RouteId]][]) {
    for (const station of route.stations) {
      if (!station.transfer) continue;

      const fromId = stopId(routeId, station.name);

      for (const targetRouteId of station.transfer) {
        const targetRoute = transitRoutes[targetRouteId];
        if (!targetRoute) continue;

        const targetStation = targetRoute.stations.find(s => s.name === station.name);
        if (!targetStation) continue;

        const toId = stopId(targetRouteId, station.name);
        const key = [fromId, toId].sort().join('|');

        if (!transferSet.has(key)) {
          transferSet.add(key);
          // Bidirectional transfers
          transfers.push({ fromStop: fromId, toStop: toId, walkMinutes: TRANSFER_PENALTY });
          transfers.push({ fromStop: toId, toStop: fromId, walkMinutes: TRANSFER_PENALTY });
        }
      }
    }
  }

  // Build transfer index for O(1) lookup by stop
  const transfersByStop = new Map<string, RaptorTransfer[]>();
  for (const t of transfers) {
    if (!transfersByStop.has(t.fromStop)) transfersByStop.set(t.fromStop, []);
    transfersByStop.get(t.fromStop)!.push(t);
  }

  const instance: RaptorInstance = { stops, routes, transfers, routesByStop, transfersByStop };

  console.log(`[RAPTOR] Built: ${stops.size} stops, ${routes.length} route-directions, ${transfers.length} transfers`);

  return instance;
}

// ── Access/Egress Stop Finder ──

/**
 * Find stops within walking/transport distance of a point.
 * Uses Haversine × 1.4 (urban detour factor). No OSRM calls.
 *
 * Transit-first: if any walk-reachable stops exist, discard transport stops.
 * No deduplication by name — all route variants at a station are included
 * so RAPTOR can access them directly without a transfer penalty.
 */
export function findAccessStops(
  data: RaptorInstance,
  coords: [number, number]
): AccessStop[] {
  const walkStops: AccessStop[] = [];
  const transportStops: AccessStop[] = [];

  for (const stop of data.stops.values()) {
    const rawDist = haversineDistance(coords, stop.coords);

    if (rawDist > MAX_HAVERSINE_TRANSPORT) continue;

    const realDist = rawDist * DETOUR_FACTOR;
    const isWalk = rawDist <= MAX_HAVERSINE_WALK;
    const speed = isWalk ? WALK_SPEED : TAXI_SPEED;

    const entry: AccessStop = {
      stopId: stop.id,
      walkMinutes: Math.ceil(realDist / speed),
      walkDistance: Math.round(realDist),
      mode: isWalk ? 'walk' : 'transport',
    };

    if (isWalk) {
      walkStops.push(entry);
    } else {
      transportStops.push(entry);
    }
  }

  // Transit-first: walk if available, transport only as fallback
  const result = walkStops.length > 0 ? walkStops : transportStops;

  // Sort by walk time for deterministic behavior
  result.sort((a, b) => a.walkMinutes - b.walkMinutes);

  return result;
}

// ── Nearest Station Finder (for "too far" taxi suggestions) ──

export function findNearestStations(
  data: RaptorInstance,
  coords: [number, number],
  count: number = 3
): { name: string; coords: [number, number]; distance: number; routeId?: RouteId }[] {
  const stations: { name: string; coords: [number, number]; distance: number; routeId?: RouteId }[] = [];

  for (const stop of data.stops.values()) {
    stations.push({
      name: stop.name,
      coords: stop.coords,
      distance: haversineDistance(coords, stop.coords),
      routeId: stop.routes[0] as RouteId,
    });
  }

  stations.sort((a, b) => a.distance - b.distance);

  // Deduplicate by name (for taxi suggestion, show unique station names)
  const seen = new Set<string>();
  return stations.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  }).slice(0, count);
}

// ── Routes Near Point Finder (for "qué rutas pasan por X" queries) ──

export type TransportType = 'metro' | 'ecovia' | 'bus';

export interface RouteNearPoint {
  routeId: RouteId;
  label: string;
  color: string;
  nearestStop: string;
  nearestStopCoords: [number, number];
  distanceToLocation: number;  // meters to the queried location
  distanceToUser?: number;     // meters to user's GPS (if available)
  type: TransportType;
}

/**
 * Find all transit routes that pass near a given location.
 * Used for queries like "¿Qué rutas pasan por el SAT?"
 * 
 * @param data - RAPTOR data instance
 * @param targetCoords - Location to search near [lng, lat]
 * @param maxDistanceMeters - Maximum distance from target (default 500m)
 * @param userLocation - Optional user GPS for sorting by proximity to user
 * @param filter - Optional filter by transport type
 * @returns Array of routes sorted by type (metro > ecovia > bus), then by distance
 */
export function findRoutesNearPoint(
  data: RaptorInstance,
  targetCoords: [number, number],
  maxDistanceMeters: number = 500,
  userLocation?: [number, number],
  filter?: TransportType | null
): RouteNearPoint[] {
  // Map to track best (closest) stop per route
  const routeMap = new Map<string, RouteNearPoint>();
  
  for (const stop of data.stops.values()) {
    const dist = haversineDistance(targetCoords, stop.coords);
    if (dist > maxDistanceMeters) continue;
    
    const routeIndices = data.routesByStop.get(stop.id);
    if (!routeIndices) continue;
    
    for (const routeIdx of routeIndices) {
      const route = data.routes[routeIdx];
      
      // Determine transport type
      const type: TransportType = route.id.startsWith('metro-') ? 'metro' 
                                : route.id === 'ecovia' ? 'ecovia' 
                                : 'bus';
      
      // Apply filter if specified
      if (filter && type !== filter) continue;
      
      // Deduplicate ida/vuelta by using base route ID
      const baseId = route.id.replace(/-ida$|-vuelta$/, '');
      
      const existing = routeMap.get(baseId);
      if (!existing || dist < existing.distanceToLocation) {
        routeMap.set(baseId, {
          routeId: route.id,
          label: route.label.replace(/ \(IDA\)$| \(VUELTA\)$/i, ''),
          color: route.color,
          nearestStop: stop.name,
          nearestStopCoords: stop.coords,
          distanceToLocation: Math.round(dist),
          distanceToUser: userLocation 
            ? Math.round(haversineDistance(stop.coords, userLocation)) 
            : undefined,
          type,
        });
      }
    }
  }
  
  // Sort: by type priority (metro > ecovia > bus), then by distance to user or location
  const typeOrder: Record<TransportType, number> = { metro: 0, ecovia: 1, bus: 2 };
  
  return [...routeMap.values()].sort((a, b) => {
    // Primary: sort by transport type
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    // Secondary: sort by distance to user if available, otherwise to location
    if (a.distanceToUser !== undefined && b.distanceToUser !== undefined) {
      return a.distanceToUser - b.distanceToUser;
    }
    return a.distanceToLocation - b.distanceToLocation;
  });
}

// ── Singleton ──

export const raptorData = buildRaptorData();
