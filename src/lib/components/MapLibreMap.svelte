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
  // Single active popup — prevent stacking
  let activePopup: maplibregl.Popup | null = null;

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

  // ── SVG icon fragments (inline, no emoji) ──
  const ICON_WALK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#787579" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="5" r="2"/><path d="M10 22l2-7 4 3v6M10 22l-2-4 4-5-3-3-2 4"/></svg>`;
  const ICON_BOARD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#285A71" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  const ICON_ALIGHT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#285A71" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`;
  const ICON_TRANSFER = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#787579" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M4 17h16M4 17l4-4M4 17l4 4M20 7H4M20 7l-4-4M20 7l-4 4"/></svg>`;
  const ICON_PIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#285A71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;

  /** Haversine distance in meters between two [lng,lat] points. */
  function haversineMeters(a: number[], b: number[]): number {
    const R = 6371e3;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /** Sum walking distance along a LineString geometry's coordinates. */
  function walkDistanceFromCoords(coords: number[][]): number {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversineMeters(coords[i - 1], coords[i]);
    return Math.round(d);
  }

  /** Show a single popup, closing any previous one. */
  function showPopup(lngLat: [number, number], html: string, offset = 10) {
    if (activePopup) activePopup.remove();
    activePopup = new maplibregl.Popup({ offset, maxWidth: '240px', className: 'neo-popup' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
    activePopup.on('close', () => { activePopup = null; });
  }

  /** Line badge: colored dot + label. */
  function lineBadge(color: string, label: string): string {
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
      <span style="font-size:12px;color:#4b5563;line-height:1.3">${label}</span>
    </div>`;
  }

  /**
   * Build combined station popup — merges info from ALL active routes
   * at this station so transfer points show a single card, not two.
   */
  function buildStationPopupHTML(stationName: string): string {
    const isBoarding = mapState.boardingStations.includes(stationName);
    const isAlighting = mapState.alightingStations.includes(stationName);

    // Collect all active routes that include this station
    const activeLines: { color: string; label: string }[] = [];
    const transferLines: { color: string; label: string }[] = [];
    const seen = new Set<string>();

    for (const rid of mapState.routes) {
      if (!rid || !transitRoutes[rid]) continue;
      const route = transitRoutes[rid];
      const station = route.stations.find(s => s.name === stationName);
      if (!station) continue;

      if (!seen.has(route.label)) {
        activeLines.push({ color: route.color, label: route.label });
        seen.add(route.label);
      }

      // Transfers from this station
      if (station.transfer) {
        for (const tid of station.transfer) {
          const tr = transitRoutes[tid];
          if (tr && !seen.has(tr.label)) {
            transferLines.push({ color: tr.color, label: tr.label });
            seen.add(tr.label);
          }
        }
      }
    }

    // Role badge
    let roleHTML = '';
    if (isBoarding && isAlighting) {
      roleHTML = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        ${ICON_TRANSFER}
        <span style="color:#285A71;font-weight:600;font-size:12px">Transbordo</span>
      </div>`;
    } else if (isBoarding) {
      roleHTML = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        ${ICON_BOARD}
        <span style="color:#285A71;font-weight:600;font-size:12px">Sube aquí</span>
      </div>`;
    } else if (isAlighting) {
      roleHTML = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px">
        ${ICON_ALIGHT}
        <span style="color:#285A71;font-weight:600;font-size:12px">Baja aquí</span>
      </div>`;
    }

    // Lines section
    const linesHTML = activeLines.map(l => lineBadge(l.color, l.label)).join('');
    const transferHTML = transferLines.length > 0
      ? `<div style="font-size:11px;color:#787579;margin-top:6px;margin-bottom:2px">Conexiones</div>` +
        transferLines.map(l => lineBadge(l.color, l.label)).join('')
      : '';

    return `<div style="font-family:system-ui,-apple-system,sans-serif">
      <div style="font-size:14px;font-weight:700;color:#1c1b1d">${stationName}</div>
      ${roleHTML}
      <div style="margin-top:6px">${linesHTML}</div>
      ${transferHTML}
    </div>`;
  }

  /** Build rich popup for origin/destination marker. */
  function buildEndpointPopupHTML(type: 'origin' | 'destination'): string {
    const isOrigin = type === 'origin';
    const point = isOrigin ? mapState.origin : mapState.destination;
    if (!point) return '';

    const label = isOrigin ? 'Tu origen' : 'Tu destino';
    const stationName = isOrigin
      ? mapState.boardingStations[0]
      : mapState.alightingStations[mapState.alightingStations.length - 1];

    // Calculate walk distance from geometry if available
    let walkInfo = '';
    if (isOrigin && mapState.walkSegments[0]?.geometry) {
      const d = walkDistanceFromCoords(mapState.walkSegments[0].geometry.coordinates);
      const mins = Math.ceil(d / 80);
      walkInfo = `<div style="display:flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;color:#787579">
        ${ICON_WALK}<span>${d}m (~${mins} min) a ${stationName || 'la estación'}</span>
      </div>`;
    } else if (!isOrigin && mapState.walkSegments.length > 0) {
      const lastWalk = mapState.walkSegments[mapState.walkSegments.length - 1];
      if (lastWalk?.geometry) {
        const d = walkDistanceFromCoords(lastWalk.geometry.coordinates);
        const mins = Math.ceil(d / 80);
        walkInfo = `<div style="display:flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;color:#787579">
          ${ICON_WALK}<span>${d}m (~${mins} min) desde ${stationName || 'la estación'}</span>
        </div>`;
      }
    }

    return `<div style="font-family:system-ui,-apple-system,sans-serif">
      <div style="display:flex;align-items:center;gap:5px">
        ${ICON_PIN}
        <span style="font-size:14px;font-weight:700;color:#1c1b1d">${point.name}</span>
      </div>
      <div style="font-size:12px;color:#285A71;font-weight:600;margin-top:2px;margin-left:19px">${label}</div>
      ${walkInfo}
    </div>`;
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

      // M3 Expressive: soft shadow layer beneath the route (elevation feel)
      addLayer({
        id: `layer-shadow-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#000000', 'line-width': isBus ? 8 : 9, 'line-opacity': 0.06, 'line-blur': 4 }
      });

      // Colored route line — slightly desaturated for M3 tonal approach
      addLayer({
        id: `layer-${id}`,
        type: 'line',
        source: `source-${id}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': route.color, 'line-width': isBus ? 5 : 6, 'line-opacity': 0.85 }
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

      // M3 Expressive station dots — tonal hierarchy through size + fill
      // Intermediate: small white dots sitting on the line (2.5px)
      // Transfer: slightly larger (3.5px)
      // Boarding/alighting: emphasized with route color fill (5px)
      addLayer({
        id: `stations-${id}`,
        type: 'circle',
        source: `stations-src-${id}`,
        paint: {
          'circle-radius': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 5,
            ['get', 'isTransfer'], 3.5,
            2.5
          ],
          'circle-color': ['case',
            ['get', 'isBoarding'], '#ffffff',
            ['get', 'isAlighting'], '#ffffff',
            '#ffffff'
          ],
          'circle-stroke-color': route.color,
          'circle-stroke-width': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 2.5,
            1.5
          ],
          'circle-opacity': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 1.0,
            0.9
          ],
        }
      });

      // Labels — boarding/alighting only bold, intermediates regular + muted
      addLayer({
        id: `labels-${id}`,
        type: 'symbol',
        source: `stations-src-${id}`,
        filter: ['any', ['get', 'isBoarding'], ['get', 'isAlighting'], ['get', 'isNamed']],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['case',
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], 11.5,
            10
          ],
          'text-offset': [0, 1.2],
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
            ['any', ['get', 'isBoarding'], ['get', 'isAlighting']], '#1c1b1d',
            '#787579'
          ],
          'text-halo-color': '#fefbff',
          'text-halo-width': 1.5,
        }
      });

      // Click handler for station dots — single combined popup
      const stationLayerId = `stations-${id}`;
      map.on('click', stationLayerId, (e: any) => {
        if (!e.features?.length) return;
        e.originalEvent.stopPropagation(); // prevent duplicate from overlapping layers
        const feat = e.features[0];
        const coords = (feat.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        showPopup(coords, buildStationPopupHTML(feat.properties.name));
      });
      map.on('mouseenter', stationLayerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', stationLayerId, () => { map.getCanvas().style.cursor = ''; });

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
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showPopup(mapState.origin!.coordinates, buildEndpointPopupHTML('origin'), 12);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(mapState.origin.coordinates)
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
          paint: { 'line-color': '#787579', 'line-width': 2.5, 'line-dasharray': [2, 3], 'line-opacity': 0.7 }
        });
      }
    }

    if (mapState.destination) {
      const el = createMarkerEl('destination');
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showPopup(mapState.destination!.coordinates, buildEndpointPopupHTML('destination'), 14);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(mapState.destination.coordinates)
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
          paint: { 'line-color': '#787579', 'line-width': 2.5, 'line-dasharray': [2, 3], 'line-opacity': 0.7 }
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

  /**
   * M3 Expressive origin/destination marker.
   * Uses tonal surface colors + M3 dual-layer elevation shadow.
   * Origin: outlined circle (start point). Destination: filled pill with icon.
   */
  function createMarkerEl(type: 'origin' | 'destination'): HTMLDivElement {
    const isOrigin = type === 'origin';

    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.cursor = 'pointer';

    if (isOrigin) {
      // Origin: outlined circle in brand primary — lightweight start point
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.background = '#fefbff';
      el.style.border = '3px solid #285A71';
      el.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,0.30), 0 1px 3px 1px rgba(0,0,0,0.15)';
    } else {
      // Destination: filled brand primary circle with inner dot
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '50%';
      el.style.background = '#285A71';
      el.style.boxShadow = '0 1px 2px 0 rgba(0,0,0,0.30), 0 2px 6px 2px rgba(0,0,0,0.15)';

      const inner = document.createElement('div');
      inner.style.width = '8px';
      inner.style.height = '8px';
      inner.style.borderRadius = '50%';
      inner.style.background = '#fefbff';
      el.appendChild(inner);
    }

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
