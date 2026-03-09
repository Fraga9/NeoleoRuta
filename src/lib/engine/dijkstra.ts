/**
 * Dijkstra's shortest-path algorithm over the transit graph.
 *
 * Returns an ordered list of RouteSteps from origin to destination,
 * or null if no path exists.
 */

import type { AdjacencyList, GraphNode } from './transitGraph';
import type { RouteId } from '$lib/data/transitRoutes';

// ── Types ──

export interface RouteStep {
  type: 'walk' | 'transit' | 'transfer';
  from: string;           // station/place name
  to: string;             // station/place name
  fromCoords: [number, number];
  toCoords: [number, number];
  duration: number;        // minutes
  routeId?: RouteId;       // which line (for transit steps)
  stopsCount?: number;     // number of intermediate stops (for transit)
  walkDistance?: number;    // meters (OSRM enriched)
  walkGeometry?: GeoJSON.LineString; // actual walking path (OSRM enriched)
}

interface DijkstraResult {
  steps: RouteStep[];
  totalDuration: number;
}

// ── Algorithm ──

export function dijkstra(
  adjacency: AdjacencyList,
  nodes: Map<string, GraphNode>,
  startId: string,
  endId: string
): DijkstraResult | null {
  // Distance map
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  // Priority queue (simple array — graph is tiny)
  const queue: { id: string; priority: number }[] = [];

  // Init
  for (const id of nodes.keys()) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }
  dist.set(startId, 0);
  queue.push({ id: startId, priority: 0 });

  // Edge case: origin === destination
  if (startId === endId) {
    return { steps: [], totalDuration: 0 };
  }

  while (queue.length > 0) {
    // Extract min
    queue.sort((a, b) => a.priority - b.priority);
    const current = queue.shift()!;

    if (visited.has(current.id)) continue;
    visited.add(current.id);

    // Found destination
    if (current.id === endId) break;

    const edges = adjacency.get(current.id) || [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const newDist = (dist.get(current.id) ?? Infinity) + edge.weight;
      if (newDist < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, newDist);
        prev.set(edge.to, current.id);
        queue.push({ id: edge.to, priority: newDist });
      }
    }
  }

  // No path found
  if (!prev.has(endId) || dist.get(endId) === Infinity) {
    console.warn(`[DIJKSTRA] No path from ${startId} to ${endId}`);
    return null;
  }

  // Reconstruct path
  const path: string[] = [];
  let current: string | null = endId;
  while (current !== null) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  // Build RouteSteps (merge consecutive transit edges on same line)
  const steps = buildSteps(path, adjacency, nodes);
  const totalDuration = dist.get(endId) ?? 0;

  console.log(`[DIJKSTRA] Path found: ${path.length} nodes, ${totalDuration} min, ${steps.length} steps`);

  return { steps, totalDuration };
}

/**
 * Converts a raw node path into human-friendly RouteSteps,
 * merging consecutive transit edges on the same line into a single step.
 */
function buildSteps(
  path: string[],
  adjacency: AdjacencyList,
  nodes: Map<string, GraphNode>
): RouteStep[] {
  const steps: RouteStep[] = [];

  let i = 0;
  while (i < path.length - 1) {
    const fromId = path[i];
    const fromNode = nodes.get(fromId)!;

    // Find the edge connecting path[i] → path[i+1]
    const edge = adjacency.get(fromId)?.find(e => e.to === path[i + 1]);
    if (!edge) {
      i++;
      continue;
    }

    if (edge.type === 'transit') {
      // Merge consecutive transit edges on the same line
      let j = i + 1;
      while (j < path.length - 1) {
        const nextEdge = adjacency.get(path[j])?.find(e => e.to === path[j + 1]);
        if (!nextEdge || nextEdge.type !== 'transit' || nextEdge.routeId !== edge.routeId) break;
        j++;
      }

      const toNode = nodes.get(path[j])!;
      const stopsCount = j - i;
      let totalDuration = 0;
      for (let k = i; k < j; k++) {
        const e = adjacency.get(path[k])?.find(e => e.to === path[k + 1]);
        totalDuration += e?.weight ?? 0;
      }

      steps.push({
        type: 'transit',
        from: fromNode.name,
        to: toNode.name,
        fromCoords: fromNode.coordinates,
        toCoords: toNode.coordinates,
        duration: totalDuration,
        routeId: edge.routeId,
        stopsCount,
      });

      i = j;
    } else {
      // Walk or transfer — single step
      const toNode = nodes.get(path[i + 1])!;
      steps.push({
        type: edge.type,
        from: fromNode.name,
        to: toNode.name,
        fromCoords: fromNode.coordinates,
        toCoords: toNode.coordinates,
        duration: edge.weight,
        routeId: edge.type === 'transfer' ? undefined : edge.routeId,
      });
      i++;
    }
  }

  return steps;
}
