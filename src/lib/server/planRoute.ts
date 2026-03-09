/**
 * Route Planner — orchestrates geocoding + graph + OSRM + Dijkstra.
 *
 * Flow:
 * 1. Geocode origin/destination → coordinates
 * 2. Connect to graph (with OSRM validation — rejects mountains/obstacles)
 * 3. Dijkstra pathfinding (weights already OSRM-accurate)
 * 4. Build RoutePlan
 *
 * If user is too far from any station → returns taxi suggestion.
 */

import { transitGraph, haversineDistance } from '$lib/engine/transitGraph';
import { dijkstra, type RouteStep } from '$lib/engine/dijkstra';
import { geocode } from '$lib/server/geocoding';
import { getRouteSegment, rankStationsByRealDistance } from '$lib/server/osrm';
import type { RouteId } from '$lib/data/transitRoutes';

// ── Types ──

export interface RoutePlan {
  origin: { name: string; coords: [number, number] };
  destination: { name: string; coords: [number, number] };
  totalDuration: number;
  steps: RouteStep[];
  linesUsed: RouteId[];
  boardingStations: string[];
  alightingStations: string[];
}

export interface PlanError {
  code: 'GEOCODE_ORIGIN' | 'GEOCODE_DEST' | 'TOO_FAR' | 'NO_ROUTE' | 'SAME_PLACE';
  message: string;
  suggestion?: {
    nearestStation: string;
    stationCoords: [number, number];
    distanceKm: number;
    taxiMinutes: number;
    taxiCostMXN: number;
    routeId?: RouteId;
  };
}

// ── OSRM helper for connectPlace ──

async function osrmValidator(
  from: [number, number],
  to: [number, number]
): Promise<{ distance: number; minutes: number; mode: 'walk' | 'transport' } | null> {
  const segment = await getRouteSegment(from, to);
  return { distance: segment.distance, minutes: segment.minutes, mode: segment.mode };
}

// ── Shared plan builder ──

async function buildPlan(
  originName: string,
  originCoords: [number, number],
  destName: string,
  destCoords: [number, number]
): Promise<{ plan: RoutePlan | null; error: PlanError | null }> {

  // Connect places to graph (async — OSRM validates walk edges)
  const originId = await transitGraph.connectPlace(originName, originCoords, 'origin', osrmValidator);
  const destId = await transitGraph.connectPlace(destName, destCoords, 'destination', osrmValidator);

  // Handle "too far" with taxi suggestions
  if (!originId) {
    if (destId) transitGraph.disconnectPlace(destId);
    return {
      plan: null,
      error: buildTooFarError(originName, originCoords),
    };
  }

  if (!destId) {
    transitGraph.disconnectPlace(originId);
    return {
      plan: null,
      error: buildTooFarError(destName, destCoords),
    };
  }

  // Dijkstra (weights are already OSRM-accurate from connectPlace)
  const result = dijkstra(transitGraph.adjacency, transitGraph.nodes, originId, destId);

  transitGraph.disconnectPlace(originId);
  transitGraph.disconnectPlace(destId);

  if (!result) {
    return {
      plan: null,
      error: { code: 'NO_ROUTE', message: 'No encontré una ruta de transporte público entre esos dos puntos.' },
    };
  }

  // Build plan
  const linesUsed: RouteId[] = [];
  const boardingStations: string[] = [];
  const alightingStations: string[] = [];

  for (const step of result.steps) {
    if (step.type === 'transit' && step.routeId) {
      if (!linesUsed.includes(step.routeId)) linesUsed.push(step.routeId);
      boardingStations.push(step.from);
      alightingStations.push(step.to);
    }
  }

  const plan: RoutePlan = {
    origin: { name: originName, coords: originCoords },
    destination: { name: destName, coords: destCoords },
    totalDuration: result.totalDuration,
    steps: result.steps,
    linesUsed,
    boardingStations,
    alightingStations,
  };

  console.log(`[ROUTING] ✅ ${plan.totalDuration} min, ${plan.steps.length} steps, lines: [${linesUsed.join(', ')}]`);

  return { plan, error: null };
}

/**
 * Build an enhanced "too far" error with taxi suggestion.
 */
function buildTooFarError(placeName: string, placeCoords: [number, number]): PlanError {
  const nearestStations = transitGraph.findNearestStations(placeCoords, 1);
  
  if (nearestStations.length > 0) {
    const nearest = nearestStations[0];
    const distKm = Math.round(nearest.haversine / 100) / 10; // round to 0.1 km
    const taxiMin = Math.ceil(nearest.haversine / 400); // ~24 km/h city average
    const taxiCost = Math.round(10 + (distKm * 15)); // ~$10 base + $15/km in MTY

    const lineName = nearest.routeId === 'ecovia' ? 'Ecovía' :
      nearest.routeId ? `Línea ${nearest.routeId.split('-')[1]}` : '';

    return {
      code: 'TOO_FAR',
      message: `"${placeName}" está a ${distKm} km de la estación más cercana (${nearest.name}, ${lineName}). Te recomendamos tomar taxi/Uber/Didi hasta ahí (~${taxiMin} min, ~$${taxiCost} MXN).`,
      suggestion: {
        nearestStation: nearest.name,
        stationCoords: nearest.coords,
        distanceKm: distKm,
        taxiMinutes: taxiMin,
        taxiCostMXN: taxiCost,
        routeId: nearest.routeId,
      },
    };
  }

  return {
    code: 'TOO_FAR',
    message: `"${placeName}" está demasiado lejos de estaciones de transporte público.`,
  };
}

// ── Public API ──

export async function planRoute(
  originName: string,
  destinationName: string
): Promise<{ plan: RoutePlan | null; error: PlanError | null }> {
  console.log(`[ROUTING] Planning: "${originName}" → "${destinationName}"`);

  if (originName.toLowerCase().trim() === destinationName.toLowerCase().trim()) {
    return { plan: null, error: { code: 'SAME_PLACE', message: '¡Ya estás ahí!' } };
  }

  const originGeo = await geocode(originName);
  if (!originGeo.coords) {
    return { plan: null, error: { code: 'GEOCODE_ORIGIN', message: `No pude encontrar "${originName}" en el mapa.` } };
  }

  const destGeo = await geocode(destinationName);
  if (!destGeo.coords) {
    return { plan: null, error: { code: 'GEOCODE_DEST', message: `No pude encontrar "${destinationName}" en el mapa.` } };
  }

  return buildPlan(originName, originGeo.coords, destinationName, destGeo.coords);
}

export async function planRouteFromCoords(
  originName: string,
  originCoords: [number, number],
  destinationName: string
): Promise<{ plan: RoutePlan | null; error: PlanError | null }> {
  console.log(`[ROUTING] Planning from GPS: [${originCoords}] → "${destinationName}"`);

  const destGeo = await geocode(destinationName);
  if (!destGeo.coords) {
    return { plan: null, error: { code: 'GEOCODE_DEST', message: `No pude encontrar "${destinationName}" en el mapa.` } };
  }

  return buildPlan(originName, originCoords, destinationName, destGeo.coords);
}
