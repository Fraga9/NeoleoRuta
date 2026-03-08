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

  let mapState = $state<MapState>({ routes: [], origin: null, destination: null, boardingStations: [], alightingStations: [] });
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

  function updateMap() {
    if (!map || !mapLoaded) return;
    cleanupLayers();

    let allCoords: number[][] = [];

    // ── TRANSIT LINES + STATIONS ──
    mapState.routes.forEach((id) => {
      if (!id || !transitRoutes[id]) return;
      const route = transitRoutes[id];

      // Line
      addSource(`source-${id}`, route.line);
      addLayer({
        id: `layer-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': route.color, 'line-width': 5, 'line-opacity': 0.85 }
      });

      // Station points
      const stationFeatures: GeoJSON.Feature[] = route.stations.map(s => {
        const isBoarding = mapState.boardingStations.includes(s.name);
        const isAlighting = mapState.alightingStations.includes(s.name);
        const isTransfer = !!(s.transfer && s.transfer.length > 0);
        return {
          type: 'Feature' as const,
          properties: { name: s.name, isTransfer, isBoarding, isAlighting },
          geometry: { type: 'Point' as const, coordinates: s.coordinates }
        };
      });

      addSource(`stations-src-${id}`, { type: 'FeatureCollection', features: stationFeatures });

      // Normal station dots
      addLayer({
        id: `stations-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        paint: {
          'circle-radius': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 8,
            ['get', 'isTransfer'], 7,
            5
          ],
          'circle-color': ['case',
            ['get', 'isBoarding'], '#22c55e',   // green for boarding
            ['get', 'isAlighting'], '#ef4444',   // red for alighting
            '#ffffff'
          ],
          'circle-stroke-color': ['case',
            ['get', 'isBoarding'], '#16a34a',
            ['get', 'isAlighting'], '#dc2626',
            route.color
          ],
          'circle-stroke-width': 2.5,
        }
      });

      // Transfer indicator ring
      addLayer({
        id: `transfers-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        filter: ['==', ['get', 'isTransfer'], true],
        paint: {
          'circle-radius': 11,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        }
      });

      // Station labels
      addLayer({
        id: `labels-${id}`,
        type: 'symbol',
        source: `stations-src-${id}`,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 13,
            11
          ],
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-font': ['Open Sans Bold', 'Open Sans Regular'],
          'text-optional': true,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['case',
            ['get', 'isBoarding'], '#16a34a',
            ['get', 'isAlighting'], '#dc2626',
            '#333'
          ],
          'text-halo-color': '#fff',
          'text-halo-width': 1.5,
        }
      });

      const coords = (route.line.features[0].geometry as any).coordinates;
      if (coords) allCoords = allCoords.concat(coords);
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

      // Walking line from origin to nearest boarding station
      const boardStation = findStationCoords(mapState.boardingStations[0]);
      if (boardStation) {
        addSource('walking-origin', {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: {
            type: 'LineString',
            coordinates: [mapState.origin.coordinates, boardStation]
          }}]
        });
        addLayer({
          id: 'walking-origin-line',
          type: 'line',
          source: 'walking-origin',
          paint: {
            'line-color': '#6b7280',
            'line-width': 3,
            'line-dasharray': [2, 3],
            'line-opacity': 0.7
          }
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

      // Walking line from last alighting station to destination
      const alightStation = findStationCoords(
        mapState.alightingStations[mapState.alightingStations.length - 1]
      );
      if (alightStation) {
        addSource('walking-dest', {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: {
            type: 'LineString',
            coordinates: [alightStation, mapState.destination.coordinates]
          }}]
        });
        addLayer({
          id: 'walking-dest-line',
          type: 'line',
          source: 'walking-dest',
          paint: {
            'line-color': '#6b7280',
            'line-width': 3,
            'line-dasharray': [2, 3],
            'line-opacity': 0.7
          }
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
