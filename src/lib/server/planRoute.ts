/**
 * Route Planner — orchestrates geocoding + RAPTOR + OSRM enrichment.
 *
 * Flow:
 * 1. Geocode origin/destination → coordinates (parallel)
 * 2. Find access/egress stops (Haversine, instant)
 * 3. RAPTOR pathfinding (Pareto-optimal, ~10ms)
 * 4. Enrich walk geometry via OSRM (2-4 calls, non-critical)
 * 5. Build RoutePlan
 *
 * If user is too far from any station → returns taxi suggestion.
 */

import { raptorData, findAccessStops, findNearestStations, haversineDistance } from '$lib/engine/raptorData';
import { raptor, type RouteStep, type RaptorJourney } from '$lib/engine/raptor';
import { geocode, geocodeMulti, type GeoCandidate } from '$lib/server/geocoding';
import { getRouteSegment } from '$lib/server/osrm';
import type { RouteId } from '$lib/data/transitRoutes';

// Re-export RouteStep so existing imports from planRoute still work
export type { RouteStep } from '$lib/engine/raptor';

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

export interface ClarificationNeeded {
  field: 'origin' | 'destination';
  original: string;
  candidates: GeoCandidate[];
  partialIntent: {
    origin?: string;
    originCoords?: [number, number];
    destination?: string;
    destCoords?: [number, number];
  };
}

export type PlanResult =
  | { type: 'plan'; plan: RoutePlan; alternatives: RoutePlan[]; error: null }
  | { type: 'clarification'; clarification: ClarificationNeeded }
  | { type: 'error'; error: PlanError };

// ── Shared plan builder (also exported for clarification flow) ──

export async function buildPlanDirect(
  originName: string,
  originCoords: [number, number],
  destName: string,
  destCoords: [number, number]
): Promise<{ plan: RoutePlan | null; alternatives: RoutePlan[]; error: PlanError | null }> {

  // Step 1: Find access/egress stops (instant — Haversine only)
  const tAccess0 = performance.now();
  const accessStops = findAccessStops(raptorData, originCoords);
  const egressStops = findAccessStops(raptorData, destCoords);
  const tAccess1 = performance.now();
  console.log(`[TIMING]   findAccessStops: ${(tAccess1 - tAccess0).toFixed(2)}ms`);

  if (accessStops.length === 0) {
    return { plan: null, alternatives: [], error: buildTooFarError(originName, originCoords) };
  }
  if (egressStops.length === 0) {
    return { plan: null, alternatives: [], error: buildTooFarError(destName, destCoords) };
  }

  console.log(`[RAPTOR] Access stops: ${accessStops.length}, Egress stops: ${egressStops.length}`);

  // Step 2: RAPTOR — Pareto-optimal routing
  const tRaptor0 = performance.now();
  const journeys = raptor(raptorData, accessStops, egressStops);
  const tRaptor1 = performance.now();
  console.log(`[TIMING]   raptor: ${(tRaptor1 - tRaptor0).toFixed(2)}ms`);

  if (journeys.length === 0) {
    // Try with excludeRoutes=[] to make sure it's not a filter issue
    return {
      plan: null,
      alternatives: [],
      error: { code: 'NO_ROUTE', message: 'No encontré una ruta de transporte público entre esos dos puntos.' },
    };
  }

  // Step 3: Select primary + alternatives
  // RAPTOR gives Pareto-optimal by transfers. Also try route diversity.
  const primary = journeys[0]; // fastest
  let alternatives = journeys.slice(1);

  // If all Pareto journeys use the same first line, generate a diverse alternative
  const tAlt0 = performance.now();
  if (alternatives.length === 0 && primary.linesUsed.length > 0) {
    const primaryFirstLine = primary.linesUsed[0];
    const baseId = primaryFirstLine.replace(/-ida$/, '').replace(/-vuelta$/, '');
    const excludeFamily = [
      `${baseId}-ida`, `${baseId}-vuelta`, primaryFirstLine
    ].filter((v, i, a) => a.indexOf(v) === i) as RouteId[];

    const diverseJourneys = raptor(raptorData, accessStops, egressStops, {
      excludeRoutes: excludeFamily,
    });

    for (const alt of diverseJourneys) {
      const altFirstLine = alt.linesUsed[0];
      if (!altFirstLine) continue;
      const altBase = altFirstLine.replace(/-ida$/, '').replace(/-vuelta$/, '');
      const isDifferent = altBase !== baseId;
      if (isDifferent && alt.totalDuration <= primary.totalDuration * 1.25) {
        alternatives.push(alt);
        break; // one diverse alternative is enough
      }
    }
  }
  const tAlt1 = performance.now();
  console.log(`[TIMING]   alternatives (2nd raptor): ${(tAlt1 - tAlt0).toFixed(2)}ms`);

  // Step 4: Build RoutePlan objects with origin/destination names filled in
  const plan = buildRoutePlan(primary, originName, originCoords, destName, destCoords);
  const altPlans = alternatives.map(j => buildRoutePlan(j, originName, originCoords, destName, destCoords));

  // Step 5: Enrich walk geometry via OSRM (blocking, 2-4 calls with 2s timeout)
  const tOSRM0 = performance.now();
  await enrichWalkGeometry(plan);
  // Don't block on alternatives — enrich them in parallel
  await Promise.all(altPlans.map(p => enrichWalkGeometry(p)));
  const tOSRM1 = performance.now();
  console.log(`[TIMING]   OSRM enrichment: ${(tOSRM1 - tOSRM0).toFixed(0)}ms`);

  console.log(`[ROUTING] ✅ ${plan.totalDuration} min, lines: [${plan.linesUsed.join(', ')}], alternatives: ${altPlans.length}`);

  return { plan, alternatives: altPlans, error: null };
}

// ── Build RoutePlan from RAPTOR journey ──

function buildRoutePlan(
  journey: RaptorJourney,
  originName: string,
  originCoords: [number, number],
  destName: string,
  destCoords: [number, number]
): RoutePlan {
  // Fill in origin/destination placeholders in walk steps
  const steps = journey.steps.map(step => {
    if (step.from === '__ORIGIN__') {
      return { ...step, from: originName, fromCoords: originCoords };
    }
    if (step.to === '__DESTINATION__') {
      return { ...step, to: destName, toCoords: destCoords };
    }
    return { ...step };
  });

  return {
    origin: { name: originName, coords: originCoords },
    destination: { name: destName, coords: destCoords },
    totalDuration: journey.totalDuration,
    steps,
    linesUsed: journey.linesUsed,
    boardingStations: journey.boardingStations,
    alightingStations: journey.alightingStations,
  };
}

// ── OSRM walk geometry enrichment ──

async function enrichWalkGeometry(plan: RoutePlan): Promise<void> {
  const walkSteps = plan.steps.filter(s => s.type === 'walk');
  if (walkSteps.length === 0) return;

  await Promise.all(
    walkSteps.map(async (step) => {
      try {
        const segment = await getRouteSegment(step.fromCoords, step.toCoords);
        // Sanity check: if OSRM distance is wildly disproportionate to Haversine,
        // discard it (likely a one-way road snapping artifact / U-turn loop).
        const straightLine = haversineDistance(step.fromCoords, step.toCoords);
        const detourRatio = straightLine > 10 ? segment.distance / straightLine : 1;
        if (detourRatio > 4) {
          console.warn(`[OSRM] Discarding pathological result: ${segment.distance}m vs ${Math.round(straightLine)}m Haversine (${detourRatio.toFixed(1)}x detour)`);
          return; // keep RAPTOR's Haversine-based estimate
        }
        step.walkGeometry = segment.geometry;
        step.walkDistance = segment.distance;
        step.duration = segment.minutes;
      } catch {
        // Keep Haversine estimate — OSRM failure is non-critical
      }
    })
  );

  // Recalculate total duration after OSRM enrichment
  plan.totalDuration = plan.steps.reduce((sum, s) => sum + s.duration, 0);
}

// ── Too far error with taxi suggestion ──

function buildTooFarError(placeName: string, placeCoords: [number, number]): PlanError {
  const nearestStations = findNearestStations(raptorData, placeCoords, 1);

  if (nearestStations.length > 0) {
    const nearest = nearestStations[0];
    const distKm = Math.round(nearest.distance / 100) / 10;
    const taxiMin = Math.ceil(nearest.distance / 400);
    const taxiCost = Math.round(10 + (distKm * 15));

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
): Promise<PlanResult> {
  console.log(`[ROUTING] Planning: "${originName}" → "${destinationName}"`);

  if (originName.toLowerCase().trim() === destinationName.toLowerCase().trim()) {
    return { type: 'error', error: { code: 'SAME_PLACE', message: '¡Ya estás ahí!' } };
  }

  // Geocode in parallel using multi-tier geocoder
  const tGeo0 = performance.now();
  const [originGeo, destGeo] = await Promise.all([
    geocodeMulti(originName),
    geocodeMulti(destinationName),
  ]);
  const tGeo1 = performance.now();
  console.log(`[TIMING]   geocoding: ${(tGeo1 - tGeo0).toFixed(0)}ms (origin: ${originGeo.status}, dest: ${destGeo.status})`);

  // Handle disambiguation — destination first, then origin
  if (destGeo.status === 'ambiguous') {
    return {
      type: 'clarification',
      clarification: {
        field: 'destination',
        original: destinationName,
        candidates: destGeo.candidates,
        partialIntent: {
          origin: originName,
          originCoords: originGeo.status === 'resolved' ? originGeo.coords : undefined,
        },
      },
    };
  }
  if (originGeo.status === 'ambiguous') {
    return {
      type: 'clarification',
      clarification: {
        field: 'origin',
        original: originName,
        candidates: originGeo.candidates,
        partialIntent: {
          destination: destinationName,
          destCoords: destGeo.status === 'resolved' ? destGeo.coords : undefined,
        },
      },
    };
  }

  // Handle not found
  if (originGeo.status === 'not_found') {
    return { type: 'error', error: { code: 'GEOCODE_ORIGIN', message: `No pude encontrar "${originName}" en el mapa. Intenta agregar la colonia o un punto de referencia cercano.` } };
  }
  if (destGeo.status === 'not_found') {
    return { type: 'error', error: { code: 'GEOCODE_DEST', message: `No pude encontrar "${destinationName}" en el mapa. Intenta agregar la colonia o un punto de referencia cercano.` } };
  }

  const result = await buildPlanDirect(originName, originGeo.coords, destinationName, destGeo.coords);
  if (result.error) return { type: 'error', error: result.error };
  return { type: 'plan', plan: result.plan!, alternatives: result.alternatives, error: null };
}

export async function planRouteFromCoords(
  originName: string,
  originCoords: [number, number],
  destinationName: string
): Promise<PlanResult> {
  console.log(`[ROUTING] Planning from GPS: [${originCoords}] → "${destinationName}"`);

  const destGeo = await geocodeMulti(destinationName);

  if (destGeo.status === 'ambiguous') {
    return {
      type: 'clarification',
      clarification: {
        field: 'destination',
        original: destinationName,
        candidates: destGeo.candidates,
        partialIntent: {
          origin: originName,
          originCoords,
        },
      },
    };
  }
  if (destGeo.status === 'not_found') {
    return { type: 'error', error: { code: 'GEOCODE_DEST', message: `No pude encontrar "${destinationName}" en el mapa. Intenta agregar la colonia o un punto de referencia cercano.` } };
  }

  const result = await buildPlanDirect(originName, originCoords, destinationName, destGeo.coords);
  if (result.error) return { type: 'error', error: result.error };
  return { type: 'plan', plan: result.plan!, alternatives: result.alternatives, error: null };
}
