import { writable } from 'svelte/store';
import type { Landmark } from '$lib/data/landmarks';

export interface LandmarkStoreState {
  activeLandmark: Landmark | null;
  pendingRouteQuery: string | null;
}

function createLandmarkStore() {
  const { subscribe, update } = writable<LandmarkStoreState>({
    activeLandmark: null,
    pendingRouteQuery: null,
  });
  return {
    subscribe,
    open:         (landmark: Landmark) => update(s => ({ ...s, activeLandmark: landmark })),
    close:        ()                   => update(s => ({ ...s, activeLandmark: null })),
    requestRoute: (name: string)       => update(() => ({ activeLandmark: null, pendingRouteQuery: name })),
    clearRoute:   ()                   => update(s => ({ ...s, pendingRouteQuery: null })),
  };
}

export const landmarkStore = createLandmarkStore();
