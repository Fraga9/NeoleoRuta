/**
 * RAPTOR Algorithm — Round-Based Public Transit Routing.
 *
 * Based on "Round-Based Public Transit Routing" (Delling, Pajor, Werneck, 2012).
 *
 * Key design decisions:
 * - Rounds represent number of transit vehicles used (round k = k vehicles, k-1 transfers)
 * - No graph construction needed — works directly on route/stop data
 * - Produces Pareto-optimal results: best arrival per number of transfers
 * - Returns RouteStep[] matching the existing frontend interface
 */

import type { RouteId } from '$lib/data/transitRoutes';
import type { RaptorInstance, RaptorRouteData, AccessStop } from './raptorData';

// ── Types ──

export interface RouteStep {
  type: 'walk' | 'transit' | 'transfer';
  from: string;           // station/place name
  to: string;
  fromCoords: [number, number];
  toCoords: [number, number];
  duration: number;        // minutes
  routeId?: RouteId;
  stopsCount?: number;
  walkDistance?: number;
  walkGeometry?: GeoJSON.LineString;
}

export interface RaptorJourney {
  steps: RouteStep[];
  totalDuration: number;
  transfers: number;
  linesUsed: RouteId[];
  boardingStations: string[];
  alightingStations: string[];
}

// Parent tracking for path reconstruction
interface ParentLabel {
  type: 'route' | 'transfer' | 'access';
  routeIdx?: number;         // index into data.routes[]
  boardingStopIdx?: number;  // index within route.stops where we boarded
  alightingStopIdx?: number; // index within route.stops where we alight
  fromStop?: string;         // for transfers: the stop we transferred from
  round: number;
}

// ── Algorithm ──

export function raptor(
  data: RaptorInstance,
  accessStops: AccessStop[],
  egressStops: AccessStop[],
  options?: {
    maxTransfers?: number;
    excludeRoutes?: RouteId[];
  }
): RaptorJourney[] {
  const MAX_ROUNDS = (options?.maxTransfers ?? 4) + 1; // rounds = vehicles, not transfers
  const excludeRoutes = new Set(options?.excludeRoutes ?? []);

  if (accessStops.length === 0 || egressStops.length === 0) return [];

  // τ[stopId] = best known arrival time (minutes from departure)
  const tau = new Map<string, number>();
  // τ_round[k][stopId] = best arrival using exactly k vehicles
  const tauRound: Map<string, number>[] = [];
  // parent[k][stopId] = how we arrived at this stop in round k
  const parent: Map<string, ParentLabel>[] = [];

  // Initialize all stops to infinity
  for (const stop of data.stops.keys()) {
    tau.set(stop, Infinity);
  }

  // Initialize round 0 (walking from origin)
  tauRound.push(new Map());
  parent.push(new Map());

  for (const { stopId, walkMinutes } of accessStops) {
    tau.set(stopId, walkMinutes);
    tauRound[0].set(stopId, walkMinutes);
    parent[0].set(stopId, { type: 'access', round: 0 });
  }

  let markedStops = new Set(accessStops.map(s => s.stopId));

  // Build egress lookup for quick destination checking
  const egressLookup = new Map<string, number>();
  for (const { stopId, walkMinutes } of egressStops) {
    egressLookup.set(stopId, walkMinutes);
  }

  // Collect Pareto-optimal journeys (best per round)
  const bestByRound: { stopId: string; totalTime: number; round: number }[] = [];

  // Check initial access → egress (direct walk, no transit)
  for (const { stopId, walkMinutes } of accessStops) {
    const egressTime = egressLookup.get(stopId);
    if (egressTime !== undefined) {
      // Can walk from origin to this stop and then to destination
      // but this would be double-walking — skip unless it's actually useful
    }
  }

  // ── Main RAPTOR loop ──
  for (let k = 1; k <= MAX_ROUNDS; k++) {
    tauRound.push(new Map());
    parent.push(new Map());

    // Copy previous round's values
    for (const [stopId, time] of tauRound[k - 1]) {
      tauRound[k].set(stopId, time);
    }

    const newMarked = new Set<string>();

    // ── Phase 1: Scan Routes ──
    // Collect which route indices need scanning (routes that serve a marked stop)
    const routesToScan = new Set<number>();
    for (const stopId of markedStops) {
      const routeIndices = data.routesByStop.get(stopId);
      if (routeIndices) {
        for (const idx of routeIndices) {
          if (!excludeRoutes.has(data.routes[idx].id)) {
            routesToScan.add(idx);
          }
        }
      }
    }

    for (const routeIdx of routesToScan) {
      const route = data.routes[routeIdx];

      // Scan along the route's stop sequence with incremental time tracking
      let boardingIdx: number | null = null;
      let boardingTime = Infinity;
      let cumulativeTime = 0;  // time from boarding to current stop

      for (let i = 0; i < route.stops.length; i++) {
        const stopId = route.stops[i];
        const prevRoundTime = tauRound[k - 1].get(stopId) ?? Infinity;

        // Can we board (or re-board) here? (arrived in previous round earlier than current ride)
        if (prevRoundTime < boardingTime + cumulativeTime) {
          boardingIdx = i;
          boardingTime = prevRoundTime;
          cumulativeTime = 0;
        }

        // If we've boarded, check arrival at this stop
        if (boardingIdx !== null && i > boardingIdx) {
          const arrivalTime = boardingTime + cumulativeTime;

          if (arrivalTime < (tau.get(stopId) ?? Infinity)) {
            tau.set(stopId, arrivalTime);
            tauRound[k].set(stopId, arrivalTime);
            newMarked.add(stopId);

            parent[k].set(stopId, {
              type: 'route',
              routeIdx,
              boardingStopIdx: boardingIdx,
              alightingStopIdx: i,
              round: k,
            });
          }
        }

        // Accumulate travel time to next stop
        if (i < route.stops.length - 1) {
          cumulativeTime += route.travelTimes[i];
        }
      }
    }

    // ── Phase 2: Transfers ──
    for (const stopId of newMarked) {
      const outgoing = data.transfersByStop.get(stopId);
      if (!outgoing) continue;

      for (const transfer of outgoing) {
        const newArrival = (tau.get(stopId) ?? Infinity) + transfer.walkMinutes;
        if (newArrival < (tau.get(transfer.toStop) ?? Infinity)) {
          tau.set(transfer.toStop, newArrival);
          tauRound[k].set(transfer.toStop, newArrival);
          newMarked.add(transfer.toStop);

          parent[k].set(transfer.toStop, {
            type: 'transfer',
            fromStop: stopId,
            round: k,
          });
        }
      }
    }

    // ── Check egress (can we reach destination?) ──
    for (const [egressStopId, egressWalk] of egressLookup) {
      const arrivalAtStop = tau.get(egressStopId) ?? Infinity;
      if (arrivalAtStop === Infinity) continue;

      const totalTime = arrivalAtStop + egressWalk;
      const existingBest = bestByRound.find(b => b.round === k);

      if (!existingBest || totalTime < existingBest.totalTime) {
        // Remove worse entry for this round
        const idx = bestByRound.findIndex(b => b.round === k);
        if (idx >= 0) bestByRound.splice(idx, 1);

        bestByRound.push({ stopId: egressStopId, totalTime, round: k });
      }
    }

    // Update marked stops for next round
    markedStops = newMarked;
    if (markedStops.size === 0) break;
  }

  if (bestByRound.length === 0) return [];

  // ── Build Pareto-optimal journeys ──
  // Keep only journeys where adding a transfer actually reduces total time
  bestByRound.sort((a, b) => a.round - b.round);

  const paretoJourneys: typeof bestByRound = [];
  let bestTime = Infinity;

  for (const entry of bestByRound) {
    if (entry.totalTime < bestTime) {
      paretoJourneys.push(entry);
      bestTime = entry.totalTime;
    }
  }

  // Sort by total time (fastest first)
  paretoJourneys.sort((a, b) => a.totalTime - b.totalTime);

  // ── Reconstruct paths ──
  const journeys: RaptorJourney[] = [];

  for (const { stopId: egressStopId, totalTime, round: bestRound } of paretoJourneys) {
    const steps = reconstructPath(
      data, parent, tauRound, accessStops, egressStops, egressStopId, bestRound
    );

    if (steps) {
      const linesUsed: RouteId[] = [];
      const boardingStations: string[] = [];
      const alightingStations: string[] = [];

      for (const step of steps) {
        if (step.type === 'transit' && step.routeId) {
          if (!linesUsed.includes(step.routeId)) linesUsed.push(step.routeId);
          boardingStations.push(step.from);
          alightingStations.push(step.to);
        }
      }

      journeys.push({
        steps,
        totalDuration: totalTime,
        transfers: Math.max(0, linesUsed.length - 1),
        linesUsed,
        boardingStations,
        alightingStations,
      });
    }
  }

  return journeys;
}

// ── Path Reconstruction ──

function reconstructPath(
  data: RaptorInstance,
  parent: Map<string, ParentLabel>[],
  tauRound: Map<string, number>[],
  accessStops: AccessStop[],
  egressStops: AccessStop[],
  egressStopId: string,
  maxRound: number
): RouteStep[] | null {
  // Work backwards from the egress stop
  const legs: {
    type: 'transit' | 'transfer';
    fromStopId: string;
    toStopId: string;
    routeId?: RouteId;
    stopsCount?: number;
    duration: number;
  }[] = [];

  let currentStop = egressStopId;
  let currentRound = maxRound;

  // Trace back through parent labels
  while (currentRound > 0) {
    const label = parent[currentRound].get(currentStop);
    if (!label) {
      // Try earlier rounds (stop might have been set in an earlier round)
      currentRound--;
      continue;
    }

    if (label.type === 'transfer') {
      const fromStop = label.fromStop!;
      const transferInfo = data.transfers.find(
        t => t.fromStop === fromStop && t.toStop === currentStop
      );

      legs.unshift({
        type: 'transfer',
        fromStopId: fromStop,
        toStopId: currentStop,
        duration: transferInfo?.walkMinutes ?? 5,
      });

      currentStop = fromStop;
      // Don't decrement round — transfer happens within the same round
      // But we need to find the route that brought us to fromStop
      const routeLabel = parent[currentRound].get(fromStop);
      if (routeLabel && routeLabel.type === 'route') {
        const route = data.routes[routeLabel.routeIdx!];
        const boardIdx = routeLabel.boardingStopIdx!;
        const alightIdx = routeLabel.alightingStopIdx!;
        const boardStopId = route.stops[boardIdx];

        let travelTime = 0;
        for (let j = boardIdx; j < alightIdx; j++) {
          travelTime += route.travelTimes[j];
        }

        legs.unshift({
          type: 'transit',
          fromStopId: boardStopId,
          toStopId: fromStop,
          routeId: route.id,
          stopsCount: alightIdx - boardIdx,
          duration: travelTime,
        });

        currentStop = boardStopId;
        currentRound--;
      }
    } else if (label.type === 'route') {
      const route = data.routes[label.routeIdx!];
      const boardIdx = label.boardingStopIdx!;
      const alightIdx = label.alightingStopIdx!;
      const boardStopId = route.stops[boardIdx];

      let travelTime = 0;
      for (let j = boardIdx; j < alightIdx; j++) {
        travelTime += route.travelTimes[j];
      }

      legs.unshift({
        type: 'transit',
        fromStopId: boardStopId,
        toStopId: currentStop,
        routeId: route.id,
        stopsCount: alightIdx - boardIdx,
        duration: travelTime,
      });

      currentStop = boardStopId;
      currentRound--;
    } else if (label.type === 'access') {
      break;
    }
  }

  if (legs.length === 0) return null;

  // ── Convert to RouteStep[] ──
  const steps: RouteStep[] = [];

  // Find the access stop that connects to the first leg's boarding stop
  const firstBoardStop = legs[0].fromStopId;
  const accessStop = accessStops.find(a => a.stopId === firstBoardStop);
  // If the first boarding stop wasn't a direct access, find the closest access stop
  // that could have led here (it was reached via access → possibly transfer)
  const accessInfo = accessStop ?? accessStops[0];

  // Access walk (origin → first boarding stop)
  // This is populated with placeholder coords — planRoute fills in origin name/coords
  const firstStop = data.stops.get(firstBoardStop)!;
  if (accessInfo) {
    steps.push({
      type: 'walk',
      from: '__ORIGIN__',           // planRoute replaces this
      to: firstStop.name,
      fromCoords: [0, 0],           // planRoute replaces this
      toCoords: firstStop.coords,
      duration: accessInfo.walkMinutes,
      walkDistance: accessInfo.walkDistance,
    });
  }

  // Transit and transfer legs
  for (const leg of legs) {
    const from = data.stops.get(leg.fromStopId)!;
    const to = data.stops.get(leg.toStopId)!;

    steps.push({
      type: leg.type,
      from: from.name,
      to: to.name,
      fromCoords: from.coords,
      toCoords: to.coords,
      duration: leg.duration,
      routeId: leg.routeId,
      stopsCount: leg.stopsCount,
    });
  }

  // Egress walk (last alighting stop → destination)
  const lastLeg = legs[legs.length - 1];
  const lastStop = data.stops.get(lastLeg.toStopId)!;
  const egressInfo = egressStops.find(e => e.stopId === egressStopId)
    ?? egressStops.find(e => e.stopId === lastLeg.toStopId);

  if (egressInfo) {
    steps.push({
      type: 'walk',
      from: lastStop.name,
      to: '__DESTINATION__',         // planRoute replaces this
      fromCoords: lastStop.coords,
      toCoords: [0, 0],              // planRoute replaces this
      duration: egressInfo.walkMinutes,
      walkDistance: egressInfo.walkDistance,
    });
  }

  return steps;
}
