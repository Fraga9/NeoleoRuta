import { writable } from 'svelte/store';
import type { RouteId } from '$lib/data/transitRoutes';

export interface JourneyPoint {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface WalkSegment {
  geometry: GeoJSON.LineString;
}

export interface MapState {
  routes: RouteId[];
  origin: JourneyPoint | null;
  destination: JourneyPoint | null;
  boardingStations: string[];   // ordered list: boardingStations[i] pairs with alightingStations[i]
  alightingStations: string[];
  // Direct route→segment lookup — eliminates fuzzy search bugs when routes share station names
  segmentMap: Record<string, { board: string; alight: string }>;
  walkSegments: WalkSegment[];
  userLocation: [number, number] | null;
}

const initialState: MapState = {
  routes: [],
  origin: null,
  destination: null,
  boardingStations: [],
  alightingStations: [],
  segmentMap: {},
  walkSegments: [],
  userLocation: null,
};

function createMapStore() {
  const { subscribe, set, update } = writable<MapState>(initialState);

  return {
    subscribe,
    drawRoute: (routeId: RouteId) => {
      update(state => {
        if (!state.routes.includes(routeId)) {
          return { ...state, routes: [...state.routes, routeId] };
        }
        return state;
      });
    },
    // Applies a complete route plan atomically — single store update so updateMap()
    // fires exactly once with all routes, stations, and walk geometries in place.
    applyPlan: (params: {
      routes: string[];
      origin: JourneyPoint;
      destination: JourneyPoint;
      boardingStations: string[];
      alightingStations: string[];
      walkGeometries: GeoJSON.LineString[];
    }) => {
      const segmentMap: Record<string, { board: string; alight: string }> = {};
      params.routes.forEach((routeId, i) => {
        segmentMap[routeId] = {
          board: params.boardingStations[i],
          alight: params.alightingStations[i],
        };
      });
      update(state => ({
        ...state,
        routes: params.routes as RouteId[],
        origin: params.origin,
        destination: params.destination,
        boardingStations: params.boardingStations,
        alightingStations: params.alightingStations,
        segmentMap,
        walkSegments: params.walkGeometries.map(g => ({ geometry: g })),
      }));
    },
    setJourney: (origin: JourneyPoint | null, destination: JourneyPoint | null, boarding: string[], alighting: string[]) => {
      update(state => ({
        ...state,
        origin,
        destination,
        boardingStations: [...state.boardingStations, ...boarding],
        alightingStations: [...state.alightingStations, ...alighting],
      }));
    },
    addStationHighlight: (stationName: string, type: 'board' | 'alight') => {
      update(state => ({
        ...state,
        boardingStations: type === 'board' ? [...state.boardingStations, stationName] : state.boardingStations,
        alightingStations: type === 'alight' ? [...state.alightingStations, stationName] : state.alightingStations,
      }));
    },
    addWalkSegment: (geometry: GeoJSON.LineString) => {
      update(state => ({ ...state, walkSegments: [...state.walkSegments, { geometry }] }));
    },
    setUserLocation: (coords: [number, number]) => {
      update(state => ({ ...state, userLocation: coords }));
    },
    clearRoutes: () => update(state => ({ ...initialState, userLocation: state.userLocation })),
  };
}

export const mapStore = createMapStore();
