<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import { mapStore, type MapState } from '$lib/stores/mapStore';
  import { transitRoutes, type RouteId } from '$lib/data/transitRoutes';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let mapContainer: HTMLDivElement;
  let map: maplibregl.Map;

  const MONTERREY_LNG = -100.3161;
  const MONTERREY_LAT = 25.6866;

  let mapState = $state<MapState>({ routes: [], origin: null, destination: null, boardingStations: [], alightingStations: [], walkSegments: [], userLocation: null });
  let mapLoaded = $state(false);

  // Keep track of markers so we can remove them
  let markers: maplibregl.Marker[] = [];

  // Animation frame IDs for cleanup
  let animationFrameIds: number[] = [];
  let pulseAnimationId: number | null = null;

  // Track which route set has been animated to avoid re-animating on store churn
  let lastAnimatedKey = '';
  // Track whether we've already centered on user location
  let didCenterOnUser = false;

  const unsubscribe = mapStore.subscribe((state) => {
    mapState = state;
    updateMap();
  });

  // IDs we dynamically create — track them for cleanup
  const dynamicLayerIds: string[] = [];
  const dynamicSourceIds: string[] = [];

  function cleanupLayers() {
    // Cancel route animations
    animationFrameIds.forEach(id => cancelAnimationFrame(id));
    animationFrameIds = [];
    // Note: lastAnimatedKey is NOT reset here — it persists so re-renders
    // of the same route don't re-trigger animation (store churn protection)

    // Remove dynamic layers and sources
    dynamicLayerIds.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    dynamicSourceIds.forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    dynamicLayerIds.length = 0;
    dynamicSourceIds.length = 0;

    // Remove markers
    markers.forEach(m => m.remove());
    markers = [];
  }

  function addSource(id: string, data: any) {
    map.addSource(id, { type: 'geojson', data });
    dynamicSourceIds.push(id);
  }

  function addLayer(layer: any) {
    map.addLayer(layer);
    dynamicLayerIds.push(layer.id);
  }

  /** Progressively reveal a LineString over durationMs. Returns a Promise that resolves when done. */
  function animateRoute(sourceId: string, fullCoords: number[][], durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const total = fullCoords.length;
      if (total < 2) { resolve(); return; }

      function tick(now: number) {
        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (!source) { resolve(); return; } // source removed — animation cancelled

        const t = Math.min((now - start) / durationMs, 1);
        const count = Math.max(2, Math.round(t * total));
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: fullCoords.slice(0, count) }
        });

        if (t < 1) {
          const id = requestAnimationFrame(tick);
          animationFrameIds.push(id);
        } else {
          resolve();
        }
      }
      const id = requestAnimationFrame(tick);
      animationFrameIds.push(id);
    });
  }

  /** Run animation tasks sequentially so the route draws as one continuous stroke. */
  async function runAnimationsSequentially(tasks: { sourceId: string; coords: number[][]; durationMs: number }[]) {
    for (const task of tasks) {
      await animateRoute(task.sourceId, task.coords, task.durationMs);
    }
  }

  /** Find the index in coords array closest to a target [lng, lat]. */
  function closestCoordIdx(coords: number[][], target: [number, number]): number {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = (coords[i][0] - target[0]) ** 2 + (coords[i][1] - target[1]) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  /**
   * Find the (board, alight) pair for a route using index-matched lookup.
   * boardingStations[i] and alightingStations[i] are always paired (same transit step).
   * Independent `find` breaks for multi-leg trips where a station (e.g. "Sendero")
   * appears in both arrays at different indices.
   */
  function findSegmentPair(routeId: RouteId): { board: string; alight: string } | null {
    const route = transitRoutes[routeId];
    for (let i = 0; i < mapState.boardingStations.length; i++) {
      const b = mapState.boardingStations[i];
      const a = mapState.alightingStations[i];
      if (route.stations.some(s => s.name === b) && route.stations.some(s => s.name === a)) {
        return { board: b, alight: a };
      }
    }
    return null;
  }

  /** Slice the route GeoJSON to only the boarding→alighting segment. Falls back to full line. */
  function getSegmentGeoJSON(routeId: RouteId): GeoJSON.FeatureCollection {
    const route = transitRoutes[routeId];
    const fullCoords = (route.line.features[0].geometry as GeoJSON.LineString).coordinates;

    const pair = findSegmentPair(routeId);
    if (!pair) return route.line;
    const { board: boardStation, alight: alightStation } = pair;

    if (!boardStation || !alightStation) return route.line;

    const boardStationData = route.stations.find(s => s.name === boardStation);
    const alightStationData = route.stations.find(s => s.name === alightStation);
    if (!boardStationData || !alightStationData) return route.line;

    // Use coordinate proximity to find the right slice point in the raw line geometry.
    // This works correctly for both metro (1 coord/station) and bus routes (hundreds of coords).
    const startIdx = closestCoordIdx(fullCoords, boardStationData.coordinates);
    const endIdx = closestCoordIdx(fullCoords, alightStationData.coordinates);
    const segmentCoords = fullCoords.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);

    return {
      type: 'FeatureCollection',
      features: [{ ...route.line.features[0], geometry: { type: 'LineString', coordinates: segmentCoords } }]
    };
  }

  function updateMap() {
    if (!map || !mapLoaded) return;
    cleanupLayers();

    let allCoords: number[][] = [];
    // Collect animation tasks in order: walk origin → transit segments → walk dest
    type AnimTask = { sourceId: string; coords: number[][]; durationMs: number };
    const walkOriginTasks: AnimTask[] = [];
    const transitTasks: AnimTask[] = [];
    const walkDestTasks: AnimTask[] = [];

    // ── TRANSIT LINES + STATIONS ──
    mapState.routes.forEach((id) => {
      if (!id || !transitRoutes[id]) return;
      const route = transitRoutes[id];
      const isBus = id.startsWith('ruta-');

      // ── Line: only the boarded segment (animated reveal) ──
      const segmentGeoJSON = getSegmentGeoJSON(id);
      const segFullCoords = (segmentGeoJSON.features[0]?.geometry as GeoJSON.LineString)?.coordinates ?? [];
      // Start with single-point LineString so layers can attach; animateRoute will reveal
      const initialLineData: GeoJSON.FeatureCollection = segFullCoords.length >= 2
        ? { type: 'FeatureCollection', features: [{ ...segmentGeoJSON.features[0], geometry: { type: 'LineString', coordinates: [segFullCoords[0], segFullCoords[0]] } }] }
        : segmentGeoJSON;
      addSource(`source-${id}`, initialLineData);

      // Casing (subtle white outline for legibility against map)
      addLayer({
        id: `layer-casing-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': isBus ? 7 : 8, 'line-opacity': 0.6 }
      });

      // Colored route line
      addLayer({
        id: `layer-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': route.color, 'line-width': isBus ? 4 : 5, 'line-opacity': 1.0 }
      });

      // ── Stations: clip to boarded segment only (use paired index lookup) ──
      const pair = findSegmentPair(id);
      let segStations = route.stations;
      if (pair) {
        const bIdx = route.stations.findIndex(s => s.name === pair.board);
        const aIdx = route.stations.findIndex(s => s.name === pair.alight);
        if (bIdx !== -1 && aIdx !== -1) {
          segStations = route.stations.slice(Math.min(bIdx, aIdx), Math.max(bIdx, aIdx) + 1);
        }
      }

      const stationFeatures: GeoJSON.Feature[] = segStations.map(s => {
        const isBoarding = mapState.boardingStations.includes(s.name);
        const isAlighting = mapState.alightingStations.includes(s.name);
        const isTransfer = !!(s.transfer && s.transfer.length > 0);
        // Anonymous bus stops (e.g. "R226 V P22") should not show labels
        const isNamed = !/^R\d+\s/.test(s.name);
        return {
          type: 'Feature' as const,
          properties: { name: s.name, isTransfer, isBoarding, isAlighting, isNamed },
          geometry: { type: 'Point' as const, coordinates: s.coordinates }
        };
      });

      addSource(`stations-src-${id}`, { type: 'FeatureCollection', features: stationFeatures });

      // Station dots — proportional hierarchy (M3/Google Maps style)
      // Boarding/alighting: 6px filled, transfer: 4px hollow, regular: 3px hollow
      addLayer({
        id: `stations-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        paint: {
          'circle-radius': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 6,
            ['get', 'isTransfer'], 4,
            3
          ],
          'circle-color': ['case',
            ['get', 'isBoarding'], '#10b981',
            ['get', 'isAlighting'], '#ef4444',
            '#ffffff'
          ],
          'circle-stroke-color': ['case',
            ['get', 'isBoarding'], '#065f46',
            ['get', 'isAlighting'], '#991b1b',
            route.color
          ],
          'circle-stroke-width': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 2,
            1.5
          ],
        }
      });

      // Labels — only named stations + boarding/alighting (hide "R226 V P22" etc.)
      addLayer({
        id: `labels-${id}`,
        type: 'symbol',
        source: `stations-src-${id}`,
        filter: ['any', ['get', 'isBoarding'], ['get', 'isAlighting'], ['get', 'isNamed']],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 12,
            10
          ],
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-font': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']],
            ['literal', ['Open Sans Bold']],
            ['literal', ['Open Sans Regular']]
          ],
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['case',
            ['get', 'isBoarding'], '#065f46',
            ['get', 'isAlighting'], '#991b1b',
            '#4b5563'
          ],
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        }
      });

      // fitBounds uses segment coords, not the full route line
      if (segFullCoords.length > 0) allCoords = allCoords.concat(segFullCoords);
      // Queue route animation
      if (segFullCoords.length >= 2) {
        transitTasks.push({ sourceId: `source-${id}`, coords: segFullCoords, durationMs: 1200 });
      }
    });

    // ── ORIGIN & DESTINATION MARKERS ──
    if (mapState.origin) {
      const el = createMarkerEl('origin');
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(mapState.origin.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 25 }).setText(mapState.origin.name))
        .addTo(map);
      markers.push(marker);
      allCoords.push(mapState.origin.coordinates);

      // Walk leg: use OSRM geometry if available, otherwise straight dashed line
      const originWalk = mapState.walkSegments[0];
      const boardStation = findStationCoords(mapState.boardingStations[0]);
      if (originWalk?.geometry || boardStation) {
        const walkCoords = originWalk?.geometry?.coordinates
          ?? [mapState.origin.coordinates, boardStation!];
        addSource('walking-origin', {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [walkCoords[0], walkCoords[0]] } }]
        });
        if (walkCoords.length >= 2) {
          walkOriginTasks.push({ sourceId: 'walking-origin', coords: walkCoords, durationMs: 800 });
        }
        addLayer({
          id: 'walking-origin-line',
          type: 'line',
          source: 'walking-origin',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#9CA3AF', 'line-width': 2.5, 'line-dasharray': [2, 3], 'line-opacity': 0.8 }
        });
      }
    }

    if (mapState.destination) {
      const el = createMarkerEl('destination');
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(mapState.destination.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 25 }).setText(mapState.destination.name))
        .addTo(map);
      markers.push(marker);
      allCoords.push(mapState.destination.coordinates);

      // Walk leg: use OSRM geometry if available, otherwise straight dashed line
      const destWalk = mapState.walkSegments[mapState.walkSegments.length - 1];
      const alightStation = findStationCoords(
        mapState.alightingStations[mapState.alightingStations.length - 1]
      );
      if (destWalk?.geometry || alightStation) {
        const walkCoords = destWalk?.geometry?.coordinates
          ?? [alightStation!, mapState.destination.coordinates];
        addSource('walking-dest', {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [walkCoords[0], walkCoords[0]] } }]
        });
        if (walkCoords.length >= 2) {
          walkDestTasks.push({ sourceId: 'walking-dest', coords: walkCoords, durationMs: 800 });
        }
        addLayer({
          id: 'walking-dest-line',
          type: 'line',
          source: 'walking-dest',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#9CA3AF', 'line-width': 2.5, 'line-dasharray': [2, 3], 'line-opacity': 0.8 }
        });
      }
    }

    // ── FIT MAP ──
    if (allCoords.length > 0) {
      const bounds = allCoords.reduce(
        (b: any, c: any) => b.extend(c),
        new maplibregl.LngLatBounds(allCoords[0] as [number, number], allCoords[0] as [number, number])
      );
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 180, left: 50, right: 50 },
        pitch: 0,
        maxZoom: 16,
        duration: 1200,
        essential: true
      });

      // Only animate once per unique route set (avoid re-animating on store churn)
      const routeKey = [
        mapState.origin?.name,
        mapState.destination?.name,
        ...mapState.routes
      ].join('|');

      const allTasks = [...walkOriginTasks, ...transitTasks, ...walkDestTasks];
      if (allTasks.length > 0 && routeKey !== lastAnimatedKey) {
        lastAnimatedKey = routeKey;
        map.once('moveend', () => runAnimationsSequentially(allTasks));
      } else if (allTasks.length > 0) {
        // Already animated — show full lines immediately
        allTasks.forEach(task => {
          const src = map.getSource(task.sourceId) as maplibregl.GeoJSONSource | undefined;
          if (src) {
            src.setData({
              type: 'Feature', properties: {},
              geometry: { type: 'LineString', coordinates: task.coords }
            });
          }
        });
      }
    }
  }

  function findStationCoords(stationName: string | undefined): [number, number] | null {
    if (!stationName) return null;
    for (const routeId of Object.keys(transitRoutes) as RouteId[]) {
      const station = transitRoutes[routeId].stations.find(
        s => s.name.toLowerCase() === stationName.toLowerCase()
      );
      if (station) return station.coordinates;
    }
    return null;
  }

  /** M3 Expressive origin/destination marker — simple flat circle, non-intrusive. */
  function createMarkerEl(type: 'origin' | 'destination'): HTMLDivElement {
    const isOrigin = type === 'origin';
    const color = isOrigin ? '#10b981' : '#ef4444';
    const borderColor = isOrigin ? '#065f46' : '#991b1b';

    const el = document.createElement('div');
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.borderRadius = '50%';
    el.style.background = color;
    el.style.border = `2.5px solid ${borderColor}`;
    el.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.8)';
    el.style.cursor = 'pointer';

    return el;
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [MONTERREY_LNG, MONTERREY_LAT],
      zoom: 12,
      pitch: 0,
      bearing: 0,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    map.on('load', () => {
      mapLoaded = true;

      // ── User location layers (persistent, not cleaned up with route layers) ──
      map.addSource('user-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Pulse ring
      map.addLayer({
        id: 'user-location-pulse',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 20,
          'circle-color': '#4285F4',
          'circle-opacity': 0.15,
          'circle-stroke-width': 0
        }
      });

      // Blue dot
      map.addLayer({
        id: 'user-location-dot',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 8,
          'circle-color': '#4285F4',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5
        }
      });

      // Pulse animation
      let pulseGrowing = true;
      let pulseRadius = 20;
      function animatePulse() {
        if (!map || !map.getLayer('user-location-pulse')) return;
        pulseRadius += pulseGrowing ? 0.5 : -0.5;
        if (pulseRadius >= 40) pulseGrowing = false;
        if (pulseRadius <= 20) pulseGrowing = true;
        map.setPaintProperty('user-location-pulse', 'circle-radius', pulseRadius);
        map.setPaintProperty('user-location-pulse', 'circle-opacity', 0.25 - (pulseRadius - 20) * 0.005);
        pulseAnimationId = requestAnimationFrame(animatePulse);
      }
      pulseAnimationId = requestAnimationFrame(animatePulse);

      updateMap();
    });
  });

  // Update user location source when it changes + center on first fix
  $effect(() => {
    if (!map || !mapLoaded || !mapState.userLocation) return;
    const src = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: mapState.userLocation }
        }]
      });
    }
    // Center on user location the first time GPS is acquired (only if no route showing)
    if (!didCenterOnUser && mapState.routes.length === 0) {
      didCenterOnUser = true;
      map.flyTo({ center: mapState.userLocation, zoom: 14, duration: 1000 });
    }
  });

  onDestroy(() => {
    unsubscribe();
    animationFrameIds.forEach(id => cancelAnimationFrame(id));
    if (pulseAnimationId !== null) cancelAnimationFrame(pulseAnimationId);
    if (map) map.remove();
  });
</script>

<div class="absolute inset-0 z-0 h-full w-full">
  <div bind:this={mapContainer} class="h-full w-full bg-background-app"></div>
</div>
