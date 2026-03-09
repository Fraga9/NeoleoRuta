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

  let mapState = $state<MapState>({ routes: [], origin: null, destination: null, boardingStations: [], alightingStations: [], walkSegments: [] });
  let mapLoaded = $state(false);

  // Keep track of markers so we can remove them
  let markers: maplibregl.Marker[] = [];

  const unsubscribe = mapStore.subscribe((state) => {
    mapState = state;
    updateMap();
  });

  // IDs we dynamically create — track them for cleanup
  const dynamicLayerIds: string[] = [];
  const dynamicSourceIds: string[] = [];

  function cleanupLayers() {
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

    // ── TRANSIT LINES + STATIONS ──
    mapState.routes.forEach((id) => {
      if (!id || !transitRoutes[id]) return;
      const route = transitRoutes[id];
      const isBus = id.startsWith('ruta-');

      // ── Line: only the boarded segment ──
      const segmentGeoJSON = getSegmentGeoJSON(id);
      addSource(`source-${id}`, segmentGeoJSON);

      // Casing (white halo for Material depth)
      addLayer({
        id: `layer-casing-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': isBus ? 9 : 11, 'line-opacity': 0.5 }
      });

      // Colored route line
      addLayer({
        id: `layer-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': route.color, 'line-width': isBus ? 5 : 6, 'line-opacity': 0.95 }
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

      // Soft glow behind boarding/alighting markers
      addLayer({
        id: `stations-glow-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        filter: ['any', ['get', 'isBoarding'], ['get', 'isAlighting']],
        paint: {
          'circle-radius': 20,
          'circle-color': ['case', ['get', 'isBoarding'], '#10b981', '#ef4444'],
          'circle-opacity': 0.15,
          'circle-blur': 1,
        }
      });

      // Station dots
      addLayer({
        id: `stations-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        paint: {
          'circle-radius': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 11,
            ['get', 'isTransfer'], 7,
            4
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
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 3,
            1.5
          ],
        }
      });

      // Outer pulse ring for boarding/alighting (M3 tonal container)
      addLayer({
        id: `stations-ring-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        filter: ['any', ['get', 'isBoarding'], ['get', 'isAlighting']],
        paint: {
          'circle-radius': 17,
          'circle-color': 'transparent',
          'circle-stroke-color': ['case', ['get', 'isBoarding'], '#10b981', '#ef4444'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.35,
        }
      });

      // Transfer ring (amber — only for transfer stops not already boarding/alighting)
      addLayer({
        id: `transfers-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        filter: ['all',
          ['==', ['get', 'isTransfer'], true],
          ['!', ['any', ['get', 'isBoarding'], ['get', 'isAlighting']]]
        ],
        paint: {
          'circle-radius': 12,
          'circle-color': 'transparent',
          'circle-stroke-color': '#f59e0b',
          'circle-stroke-width': 2.5,
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
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 13,
            11
          ],
          'text-offset': [0, 1.9],
          'text-anchor': 'top',
          'text-font': ['Open Sans Bold', 'Open Sans Regular'],
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['case',
            ['get', 'isBoarding'], '#065f46',
            ['get', 'isAlighting'], '#991b1b',
            '#1c1c2e'
          ],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        }
      });

      // fitBounds uses segment coords, not the full route line
      const segCoords = (segmentGeoJSON.features[0]?.geometry as GeoJSON.LineString)?.coordinates;
      if (segCoords) allCoords = allCoords.concat(segCoords);
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
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walkCoords } }]
        });
        addLayer({
          id: 'walking-origin-line',
          type: 'line',
          source: 'walking-origin',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#6366f1', 'line-width': 3, 'line-dasharray': [1.5, 2.5], 'line-opacity': 0.75 }
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
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walkCoords } }]
        });
        addLayer({
          id: 'walking-dest-line',
          type: 'line',
          source: 'walking-dest',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#6366f1', 'line-width': 3, 'line-dasharray': [1.5, 2.5], 'line-opacity': 0.75 }
        });
      }
    }

    // ── FIT MAP ──
    if (allCoords.length > 0) {
      const bounds = allCoords.reduce(
        (b: any, c: any) => b.extend(c),
        new maplibregl.LngLatBounds(allCoords[0] as [number, number], allCoords[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: 100, pitch: 45, maxZoom: 14 });
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

  function createMarkerEl(type: 'origin' | 'destination'): HTMLDivElement {
    const el = document.createElement('div');
    const isOrigin = type === 'origin';
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.borderRadius = '50% 50% 50% 0';
    el.style.transform = 'rotate(-45deg)';
    el.style.background = isOrigin ? '#22c55e' : '#ef4444';
    el.style.border = `3px solid ${isOrigin ? '#16a34a' : '#dc2626'}`;
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    el.style.cursor = 'pointer';

    const inner = document.createElement('div');
    inner.style.width = '12px';
    inner.style.height = '12px';
    inner.style.background = 'white';
    inner.style.borderRadius = '50%';
    inner.style.position = 'absolute';
    inner.style.top = '50%';
    inner.style.left = '50%';
    inner.style.transform = 'translate(-50%, -50%) rotate(45deg)';
    el.appendChild(inner);

    return el;
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [MONTERREY_LNG, MONTERREY_LAT],
      zoom: 12,
      pitch: 45,
      bearing: -10,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    map.on('load', () => {
      mapLoaded = true;
      updateMap();
    });
  });

  onDestroy(() => {
    unsubscribe();
    if (map) map.remove();
  });
</script>

<div class="absolute inset-0 z-0 h-full w-full">
  <div bind:this={mapContainer} class="h-full w-full bg-background-app"></div>
</div>
