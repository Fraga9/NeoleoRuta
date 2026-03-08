import { writable } from 'svelte/store';
import type { RouteId } from '$lib/data/transitRoutes';

export interface JourneyPoint {
  name: string;
  coordinates: [number, number]; // [lng, lat]
}

export interface MapState {
  routes: RouteId[];
  origin: JourneyPoint | null;
  destination: JourneyPoint | null;
  boardingStations: string[];   // station names to highlight as "board here"
  alightingStations: string[];  // station names to highlight as "get off here"
}

const initialState: MapState = {
  routes: [],
  origin: null,
  destination: null,
  boardingStations: [],
  alightingStations: [],
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
    clearRoutes: () => set(initialState),
  };
}

export const mapStore = createMapStore();
