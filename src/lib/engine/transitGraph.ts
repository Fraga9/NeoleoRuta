/**
 * Transit Graph — weighted directed graph for pathfinding.
 *
 * Design decisions:
 * - Dijkstra (not A*): graph is ~40 nodes, A* heuristic overhead not justified
 * - Walk speed: 80 m/min (4.8 km/h) — standard urban pedestrian speed
 * - Two connection tiers:
 *   1. Walk (≤2000m OSRM): weight = distance / 80 m/min
 *   2. Transport/taxi (2000–3500m OSRM): weight = distance / 400 m/min
 *   3. Rejected (>3500m): not connected
 * - Haversine pre-filter: 2500m (must be generous enough to catch stations
 *   whose OSRM distance is within 3500m — street detours can double Haversine)
 * - OSRM ratio check only for Haversine > 500m (short distances have naturally
 *   high ratios due to urban street grids — e.g. 4.4× for 162m is normal)
 * - Metro: 2 min/stop, Ecovía: 4 min/stop (variable frequency)
 * - Transfer penalty: 5 min (includes walking + waiting)
 */

import { transitRoutes, type RouteId, type Station } from '$lib/data/transitRoutes';

// ── Types ──

export interface GraphNode {
  id: string;            // e.g. "metro-1:Exposición" or "place:origin"
  name: string;
  coordinates: [number, number];
  type: 'station' | 'place';
  routeId?: RouteId;
}

export interface GraphEdge {
  from: string;    // node id
  to: string;      // node id
  weight: number;  // minutes
  type: 'transit' | 'transfer' | 'walk';
  routeId?: RouteId;
}

export type AdjacencyList = Map<string, GraphEdge[]>;

// ── Constants ──

const WEIGHTS = {
  METRO_PER_STOP: 2,        // minutes between metro stations
  BUS_PER_STOP: 4,          // minutes between ecovía/bus stops
  TRANSFER: 5,              // minutes for line transfer
  WALK_SPEED: 80,           // meters per minute (4.8 km/h)
  TAXI_SPEED: 400,          // meters per minute (~24 km/h city average)
  MAX_WALK_METERS: 2500,    // Haversine pre-filter radius (generous to catch taxi-range stations)
  MAX_OSRM_WALK: 2000,      // ≤2000m OSRM → walk edge
  MAX_OSRM_TRANSPORT: 3500, // 2000–3500m OSRM → transport/taxi edge
  // Ratio check only applies when Haversine > 500m (short distances naturally
  // have high ratios because streets zig-zag around city blocks — a 162m
  // straight line becomes 717m by street, ratio 4.4×, which is normal).
  MIN_HAVERSINE_FOR_RATIO: 500,  // only check ratio if Haversine > this
  MAX_OSRM_RATIO: 5.0,          // reject if OSRM > 5× Haversine AND Haversine > 500m
};

// ── Haversine ──

export function haversineDistance(
  coord1: [number, number],
  coord2: [number, number]
): number {
  const R = 6371000;
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Graph Builder ──

export class TransitGraph {
  nodes: Map<string, GraphNode> = new Map();
  adjacency: AdjacencyList = new Map();

  constructor() {
    this.buildFromRoutes();
  }

  private nodeId(routeId: RouteId, stationName: string): string {
    return `${routeId}:${stationName}`;
  }

  private addNode(node: GraphNode) {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, []);
    }
  }

  private addEdge(edge: GraphEdge) {
    this.adjacency.get(edge.from)?.push(edge);
  }

  private getStopWeight(routeId: RouteId): number {
    return routeId === 'ecovia' ? WEIGHTS.BUS_PER_STOP : WEIGHTS.METRO_PER_STOP;
  }

  private buildFromRoutes() {
    // PASS 1: Add ALL station nodes first
    for (const [routeId, route] of Object.entries(transitRoutes) as [RouteId, typeof transitRoutes[RouteId]][]) {
      for (const station of route.stations) {
        const id = this.nodeId(routeId, station.name);
        this.addNode({
          id,
          name: station.name,
          coordinates: station.coordinates,
          type: 'station',
          routeId,
        });
      }
    }

    // PASS 2: Add transit edges (bidirectional)
    for (const [routeId, route] of Object.entries(transitRoutes) as [RouteId, typeof transitRoutes[RouteId]][]) {
      const weight = this.getStopWeight(routeId);

      for (let i = 0; i < route.stations.length - 1; i++) {
        const currId = this.nodeId(routeId, route.stations[i].name);
        const nextId = this.nodeId(routeId, route.stations[i + 1].name);

        this.addEdge({ from: currId, to: nextId, weight, type: 'transit', routeId });
        this.addEdge({ from: nextId, to: currId, weight, type: 'transit', routeId });
      }
    }

    // PASS 3: Transfer edges between lines at shared stations
    for (const [routeId, route] of Object.entries(transitRoutes) as [RouteId, typeof transitRoutes[RouteId]][]) {
      for (const station of route.stations) {
        if (!station.transfer) continue;
        const fromId = this.nodeId(routeId, station.name);

        for (const targetRouteId of station.transfer) {
          const targetStation = transitRoutes[targetRouteId]?.stations.find(
            s => s.name === station.name
          );
          if (!targetStation) {
            console.warn(`[GRAPH] Transfer warning: ${station.name} not found on ${targetRouteId}`);
            continue;
          }
          const toId = this.nodeId(targetRouteId, station.name);

          this.addEdge({ from: fromId, to: toId, weight: WEIGHTS.TRANSFER, type: 'transfer' });
          this.addEdge({ from: toId, to: fromId, weight: WEIGHTS.TRANSFER, type: 'transfer' });
        }
      }
    }

    console.log(`[GRAPH] Built: ${this.nodes.size} nodes, ${this.edgeCount()} edges`);
  }

  private edgeCount(): number {
    let count = 0;
    for (const edges of this.adjacency.values()) count += edges.length;
    return count;
  }

  /**
   * Connect an external place to the graph (ASYNC — uses OSRM).
   *
   * TWO-PASS STRATEGY (transit-first):
   * Pass 1: Connect ONLY walk-reachable stations (OSRM ≤ 2000m).
   *         If any found → DONE. No taxi edges added.
   * Pass 2: ONLY if Pass 1 found ZERO walk stations, connect
   *         transport/taxi stations (OSRM 2000–3500m) as fallback.
   *
   * This ensures Dijkstra NEVER sees taxi edges when walkable
   * alternatives exist, preventing it from preferring faster
   * taxi routes (21 min) over valid transit routes (41 min).
   *
   * Haversine pre-filter at 2500m catches candidates for both tiers.
   * Ratio check (OSRM > 5× Haversine) only applied when Haversine > 500m.
   *
   * Returns the place node id, or null if too far from all stations.
   */
  async connectPlace(
    name: string,
    coords: [number, number],
    tag: string,
    osrmFn?: (from: [number, number], to: [number, number]) => Promise<{ distance: number; minutes: number; mode: 'walk' | 'transport' } | null>
  ): Promise<string | null> {
    const placeId = `place:${tag}`;

    // Step 1: Haversine pre-filter — find candidates within 2500m
    const candidates: { nodeId: string; haversine: number; node: GraphNode }[] = [];

    for (const node of this.nodes.values()) {
      if (node.type !== 'station') continue;
      const dist = haversineDistance(coords, node.coordinates);
      if (dist <= WEIGHTS.MAX_WALK_METERS) {
        candidates.push({ nodeId: node.id, haversine: dist, node });
      }
    }

    if (candidates.length === 0) {
      console.warn(`[GRAPH] No stations within ${WEIGHTS.MAX_WALK_METERS}m (Haversine) of "${name}"`);
      return null;
    }

    // Step 2: OSRM validation — separate into walk vs transport buckets
    const walkStations: { nodeId: string; minutes: number }[] = [];
    const transportStations: { nodeId: string; minutes: number }[] = [];

    if (osrmFn) {
      const osrmResults = await Promise.all(
        candidates.map(async (c) => {
          const result = await osrmFn(coords, c.node.coordinates);
          return { ...c, osrm: result };
        })
      );

      for (const r of osrmResults) {
        if (!r.osrm) {
          // OSRM failed — fallback to Haversine as walk
          walkStations.push({
            nodeId: r.nodeId,
            minutes: Math.ceil(r.haversine / WEIGHTS.WALK_SPEED),
          });
          continue;
        }

        // Rejection criteria:
        // 1. OSRM distance > MAX_OSRM_TRANSPORT (too far even for taxi)
        // 2. Haversine > 500m AND ratio > 5.0 (likely mountain/highway obstacle)
        //
        // We do NOT check ratio for short distances (< 500m Haversine) because
        // urban street grids naturally produce high ratios for nearby points
        // (e.g., 162m Haversine → 717m OSRM = ratio 4.4× is normal city walking).
        const ratio = r.osrm.distance / r.haversine;
        const tooFarAbsolute = r.osrm.distance > WEIGHTS.MAX_OSRM_TRANSPORT;
        const likelyObstacle = r.haversine > WEIGHTS.MIN_HAVERSINE_FOR_RATIO
          && ratio > WEIGHTS.MAX_OSRM_RATIO;

        if (tooFarAbsolute || likelyObstacle) {
          const reason = tooFarAbsolute
            ? `OSRM ${r.osrm.distance}m > ${WEIGHTS.MAX_OSRM_TRANSPORT}m limit`
            : `OSRM ${r.osrm.distance}m vs Haversine ${Math.round(r.haversine)}m (ratio ${ratio.toFixed(1)} > ${WEIGHTS.MAX_OSRM_RATIO})`;
          console.log(`[GRAPH] ❌ Rejected ${r.nodeId}: ${reason}`);
          continue;
        }

        // Bucket into walk or transport tier
        if (r.osrm.distance <= WEIGHTS.MAX_OSRM_WALK) {
          const minutes = Math.ceil(r.osrm.distance / WEIGHTS.WALK_SPEED);
          walkStations.push({ nodeId: r.nodeId, minutes });
          console.log(`[GRAPH] 🚶 Walk ${r.nodeId}: ${r.osrm.distance}m, ${minutes} min`);
        } else {
          const minutes = Math.ceil(r.osrm.distance / WEIGHTS.TAXI_SPEED);
          transportStations.push({ nodeId: r.nodeId, minutes });
          console.log(`[GRAPH] 🚕 Transport ${r.nodeId}: ${r.osrm.distance}m, ${minutes} min`);
        }
      }
    } else {
      // No OSRM available — use Haversine (for testing)
      for (const c of candidates) {
        walkStations.push({
          nodeId: c.nodeId,
          minutes: Math.ceil(c.haversine / WEIGHTS.WALK_SPEED),
        });
      }
    }

    // Step 3: Two-pass edge creation (transit-first principle)
    // Pass 1: If ANY walk stations exist, use ONLY those — no taxi edges.
    // Pass 2: ONLY if zero walk stations, fall back to transport/taxi edges.
    const selectedStations = walkStations.length > 0 ? walkStations : transportStations;
    const selectedMode = walkStations.length > 0 ? 'walk' : 'transport';

    if (selectedStations.length === 0) {
      console.warn(`[GRAPH] No OSRM-validated stations near "${name}" (all rejected)`);
      return null;
    }

    console.log(`[GRAPH] ${name}: using ${selectedMode} edges (${walkStations.length} walk, ${transportStations.length} transport candidates)`);

    this.addNode({ id: placeId, name, coordinates: coords, type: 'place' });

    for (const { nodeId, minutes } of selectedStations) {
      this.addEdge({ from: placeId, to: nodeId, weight: minutes, type: 'walk' });
      this.addEdge({ from: nodeId, to: placeId, weight: minutes, type: 'walk' });
    }

    return placeId;
  }

  /**
   * Find the nearest station by Haversine (for taxi suggestion when too far to walk).
   */
  findNearestStations(coords: [number, number], count: number = 3): { id: string; name: string; coords: [number, number]; haversine: number; routeId?: RouteId }[] {
    const stations: { id: string; name: string; coords: [number, number]; haversine: number; routeId?: RouteId }[] = [];

    for (const node of this.nodes.values()) {
      if (node.type !== 'station') continue;
      stations.push({
        id: node.id,
        name: node.name,
        coords: node.coordinates,
        haversine: haversineDistance(coords, node.coordinates),
        routeId: node.routeId,
      });
    }

    stations.sort((a, b) => a.haversine - b.haversine);

    // Deduplicate by name (same station on multiple lines)
    const seen = new Set<string>();
    return stations.filter(s => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    }).slice(0, count);
  }

  /**
   * Remove a temporary place node and its edges.
   */
  disconnectPlace(placeId: string) {
    this.nodes.delete(placeId);
    this.adjacency.delete(placeId);
    for (const edges of this.adjacency.values()) {
      const idx = edges.findIndex(e => e.to === placeId);
      if (idx !== -1) edges.splice(idx, 1);
    }
  }

  /**
   * Validate graph integrity.
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const [id] of this.nodes) {
      const edges = this.adjacency.get(id);
      if (!edges || edges.length === 0) {
        issues.push(`Orphan node: ${id}`);
      }
    }

    for (const [fromId, edges] of this.adjacency) {
      for (const edge of edges) {
        if (!this.nodes.has(edge.to)) {
          issues.push(`Dangling edge: ${fromId} → ${edge.to}`);
        }
      }
    }

    for (const [fromId, edges] of this.adjacency) {
      for (const edge of edges) {
        if (edge.type !== 'transfer') continue;
        const reverseEdges = this.adjacency.get(edge.to);
        const hasReverse = reverseEdges?.some(e => e.to === fromId && e.type === 'transfer');
        if (!hasReverse) {
          issues.push(`One-way transfer: ${fromId} → ${edge.to}`);
        }
      }
    }

    if (issues.length > 0) {
      console.warn('[GRAPH VALIDATION]', issues);
    } else {
      console.log('[GRAPH VALIDATION] ✅ All checks passed');
    }

    return { valid: issues.length === 0, issues };
  }
}

// Singleton instance
export const transitGraph = new TransitGraph();
transitGraph.validate();
