<script lang="ts">
  import { onDestroy } from 'svelte';
  import MapLibreMap from '$lib/components/MapLibreMap.svelte';
  import ChatInterface from '$lib/components/ChatInterface.svelte';
  import HamburgerMenu from '$lib/components/HamburgerMenu.svelte';
  import ActionPanel from '$lib/components/ActionPanel.svelte';
  import LandmarkModal from '$lib/components/LandmarkModal.svelte';
  import RouteInfoCard, { type ActiveRouteInfo } from '$lib/components/RouteInfoCard.svelte';
  import { transitRoutes, type RouteId } from '$lib/data/transitRoutes';
  import { mapStore } from '$lib/stores/mapStore';

  // ── Geolocation ──
  let userLocation = $state<[number, number] | null>(null);
  let locationStatus = $state<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  let watchId: number | null = null;

  function requestLocation() {
    if (!navigator.geolocation) { locationStatus = 'denied'; return; }
    locationStatus = 'requesting';
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        userLocation = coords;
        mapStore.setUserLocation(coords);
        locationStatus = 'granted';
      },
      () => { locationStatus = 'denied'; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  onDestroy(() => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  });

  $effect(() => { if (locationStatus === 'idle') requestLocation(); });

  // ── Panel State ──
  let activePanel = $state<'none' | 'nearby' | 'all' | 'payment' | 'recharge' | 'payment:urbani' | 'payment:memuevo' | 'fares'>('none');

  // ── Active Route ──
  let activeRoute = $state<ActiveRouteInfo | null>(null);

  function closeRoute() {
    activeRoute = null;
    mapStore.clearRoutes();
  }

  // ── Helper: Badge por ruta ──
  function getBadge(base: string): string {
    if (['metro-1', 'metro-2', 'metro-3'].includes(base)) return 'Metro';
    if (base === 'ecovia') return 'Ecovía';
    if (base.startsWith('transmetro-')) return 'Transmetro';
    if (['ruta-209-olivos', 'ruta-220-pedregal', 'ruta-226-bosques', 'ruta-unidad-laredo'].includes(base)) return 'Ruta Express';
    return 'Ruta Integrada';
  }

  // ── Helper: Tarifa por ruta ──
  function getRouteFare(id: string): string {
    const base = id.replace(/-ida$/, '').replace(/-vuelta$/, '');
    if (['metro-1', 'metro-2', 'metro-3', 'ecovia'].includes(base)) return '$9.90';
    if (['ruta-209-olivos', 'ruta-220-pedregal', 'ruta-226-bosques', 'ruta-unidad-laredo'].includes(base)) return '$16.50';
    return '$15';
  }

  // ── Abrir ruta en mapa + mostrar RouteInfoCard ──
  function openRoute(routeId: string) {
    const base = routeId.replace(/-ida$/, '').replace(/-vuelta$/, '');
    const isMeta = ['metro-1', 'metro-2', 'metro-3', 'ecovia'].includes(base);
    const hasDirections = !isMeta;
    const displayId = (hasDirections ? `${base}-ida` : base) as RouteId;
    const r = transitRoutes[displayId] ?? transitRoutes[base as RouteId];
    if (!r) return;
    mapStore.clearRoutes();
    mapStore.drawRoute(displayId);
    activeRoute = {
      baseId: base,
      hasDirections,
      direction: 'ida',
      label: r.label.replace(/ \(IDA\)$/, '').replace(/ \(VUELTA\)$/, ''),
      color: r.color,
      fare: getRouteFare(base),
      badge: getBadge(base),
      stationsCount: r.stations.length,
      firstStop: r.stations[0].name,
      lastStop: r.stations[r.stations.length - 1].name,
    };
    activePanel = 'none';
  }

  // ── Helper: Distancia ──
  function getDistance(coord1: [number, number], coord2: [number, number]) {
    const R = 6371e3;
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(coord1[1]*Math.PI/180)*Math.cos(coord2[1]*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ── Panel Content ──
  const panelContent = $derived.by(() => {
    if (activePanel === 'all') {
      const routeIcon = 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4';
      const metroIcon = 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6';
      const routeGroups: Array<{ id: RouteId; badge: string; fare: string; iconPath: string }> = [
        { id: 'metro-1',                          badge: 'Metro',           fare: '$9.90',  iconPath: metroIcon },
        { id: 'metro-2',                          badge: 'Metro',           fare: '$9.90',  iconPath: metroIcon },
        { id: 'metro-3',                          badge: 'Metro',           fare: '$9.90',  iconPath: metroIcon },
        { id: 'ecovia',                           badge: 'Ecovía',          fare: '$9.90',  iconPath: metroIcon },
        { id: 'transmetro-sendero-casco-ida',     badge: 'Transmetro',      fare: '$15',    iconPath: routeIcon },
        { id: 'transmetro-sendero-miravista-ida', badge: 'Transmetro',      fare: '$15',    iconPath: routeIcon },
        { id: 'transmetro-sendero-monterreal-ida',badge: 'Transmetro',      fare: '$15',    iconPath: routeIcon },
        { id: 'transmetro-sendero-sn-apodaca-ida',badge: 'Transmetro',      fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-1-central-ida',               badge: 'Ruta Integrada',  fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-13-c4-ida',                   badge: 'Ruta Integrada',  fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-19-san-miguel-ida',           badge: 'Ruta Integrada',  fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-233-cumbres-ida',             badge: 'Ruta Integrada',  fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-233-uanl-ida',                badge: 'Ruta Integrada',  fare: '$15',    iconPath: routeIcon },
        { id: 'ruta-209-olivos-ida',              badge: 'Ruta Express',    fare: '$16.50', iconPath: routeIcon },
        { id: 'ruta-220-pedregal-ida',            badge: 'Ruta Express',    fare: '$16.50', iconPath: routeIcon },
        { id: 'ruta-226-bosques-ida',             badge: 'Ruta Express',    fare: '$16.50', iconPath: routeIcon },
        { id: 'ruta-unidad-laredo-ida',           badge: 'Ruta Express',    fare: '$16.50', iconPath: routeIcon },
      ];
      const items = routeGroups
        .filter(g => transitRoutes[g.id])
        .map(g => {
          const r = transitRoutes[g.id];
          return {
            id: g.id,
            title: r.label.replace(/ \(IDA\)$/, ''),
            description: `Tarifa: ${g.fare}`,
            color: r.color,
            badge: g.badge,
            iconPath: g.iconPath,
            action: () => openRoute(g.id)
          };
        });
      return { title: 'Todas las Rutas', subtitle: 'Toca una ruta para verla en el mapa', items, footer: 'Tarifas con tarjeta Me Muevo · Efectivo puede variar' };
    }

    if (activePanel === 'fares') {
      return {
        title: 'Tarifas 2025',
        subtitle: 'Precios con tarjeta Me Muevo',
        items: [
          {
            id: 'c1', title: 'Metro / Ecovía',
            description: 'Tarifa plena · Transferencia: $7.50',
            extraInfo: '$9.90',
            color: '#E5A52B', badge: 'Clase 1',
            iconPath: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'
          },
          {
            id: 'c2', title: 'Transmetro',
            description: 'Tarifa plena · Transferencia: $7.50',
            extraInfo: '$15.00',
            color: '#285A71', badge: 'Clase 2',
            iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
          },
          {
            id: 'c3', title: 'Ruta Integrada',
            description: 'Tarifa plena · Transferencia: $7.50',
            extraInfo: '$15.00',
            color: '#006064', badge: 'Clase 3',
            iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
          },
          {
            id: 'c4', title: 'Ruta Express',
            description: 'Tarifa plena · Transferencia: $8.25',
            extraInfo: '$16.50',
            color: '#7c3aed', badge: 'Clase 4',
            iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
          }
        ],
        footer: 'Integración Me Muevo: 2° viaje 50% · 3° gratis · Metro→Metro sin costo adicional'
      };
    }

    if (activePanel === 'nearby') {
      if (!userLocation) return { title: 'Rutas Cercanas', subtitle: 'Buscando GPS...', items: [] };
      // Group by base route — keep closest direction to avoid showing IDA + VUELTA duplicates
      const routeMap = new Map<string, { id: string; r: typeof transitRoutes[RouteId]; dist: number; closestStop: string }>();
      for (const [id, r] of Object.entries(transitRoutes)) {
        const dists = r.stations.map(s => getDistance(userLocation!, s.coordinates));
        const min = Math.min(...dists);
        const base = id.replace(/-ida$/, '').replace(/-vuelta$/, '');
        const existing = routeMap.get(base);
        if (!existing || min < existing.dist) {
          routeMap.set(base, { id, r, dist: min, closestStop: r.stations[dists.indexOf(min)].name });
        }
      }
      const items = Array.from(routeMap.entries())
        .filter(([, v]) => v.dist < 1200)
        .sort(([, a], [, b]) => a.dist - b.dist)
        .map(([base, v]) => ({
          id: base,
          title: v.r.label.replace(/ \(IDA\)$/, '').replace(/ \(VUELTA\)$/, ''),
          description: `Parada: ${v.closestStop} · Tarifa: ${getRouteFare(base)}`,
          extraInfo: v.dist < 1000 ? `${Math.round(v.dist)}m` : `${(v.dist / 1000).toFixed(1)}km`,
          color: v.r.color,
          badge: getBadge(base),
          iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
          rawDist: v.dist,
          action: () => openRoute(v.id)
        }));
      return { title: 'Rutas Cercanas', subtitle: 'A menos de 1km de ti', items, footer: 'Toca una ruta para verla en el mapa' };
    }

    if (activePanel === 'payment') {
      return {
        title: 'Métodos de Pago',
        subtitle: 'Selecciona para ver guía rápida',
        items: [
          { 
            id: 'u', title: 'App Urbani', description: 'Pago digital con QR (Metro y Camiones)', color: '#CFDA5A', badge: 'Recomendado', 
            iconPath: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
            action: () => activePanel = 'payment:urbani'
          },
          { 
            id: 'm', title: 'Tarjeta Me Muevo', description: 'Tarjeta física recargable', color: '#285A71', 
            iconPath: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
            action: () => activePanel = 'payment:memuevo'
          }
        ],
        footer: 'Información actualizada de Monterrey'
      };
    }

    if (activePanel === 'payment:urbani') {
      return {
        title: 'Guía App Urbani',
        subtitle: 'Pasos para usar QR',
        items: [
          { id: '1', title: 'Descarga la App', description: 'Disponible en iOS y Android.', color: '#CFDA5A', iconPath: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' },
          { id: '2', title: 'Recarga Saldo', description: 'Usa tarjeta de débito/crédito o paga en OXXO.', color: '#285A71', iconPath: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
          { id: '3', title: 'Genera el QR', description: 'Selecciona "Metro" o "Bus" y activa tu boleto.', color: '#CFDA5A', iconPath: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' }
        ],
        footer: 'Muestra el QR en el validador al subir',
        onBack: () => activePanel = 'payment'
      };
    }

    if (activePanel === 'payment:memuevo') {
      return {
        title: 'Guía Me Muevo',
        subtitle: 'Uso de tarjeta física',
        items: [
          { id: '1', title: 'Compra tu tarjeta', description: 'En máquinas de estaciones del Metro ($30 pesos).', color: '#285A71', iconPath: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
          { id: '2', title: 'Recarga saldo', description: 'En estaciones de Metro o sucursales OXXO.', color: '#e11d48', iconPath: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
          { id: '3', title: 'Pasa por el sensor', description: 'Acerca tu tarjeta al validador (Metro o Camión).', color: '#285A71', iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' }
        ],
        footer: 'Válida en Metro, Transmetro y Rutas Muevo León',
        onBack: () => activePanel = 'payment'
      };
    }

    if (activePanel === 'recharge') {
      return {
        title: 'Puntos de Recarga',
        subtitle: 'Dónde abonar a tus tarjetas',
        items: [
          { id: 'o', title: 'OXXO', description: 'Recarga Me Muevo en caja', color: '#e11d48', extraInfo: 'Todas las sucursales', iconPath: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
          { id: 'm', title: 'Estaciones de Metro', description: 'Máquinas automáticas de venta y recarga', color: '#ff0000', extraInfo: 'L1, L2, L3', iconPath: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' }
        ],
        footer: 'Las máquinas solo aceptan efectivo'
      };
    }

    return { title: '', subtitle: '', items: [] };
  });

  function handleMenuAction(id: string) {
    if (id === 'nearby')   activePanel = 'nearby';
    if (id === 'all')      activePanel = 'all';
    if (id === 'payment')  activePanel = 'payment';
    if (id === 'recharge') activePanel = 'recharge';
    if (id === 'fares')    activePanel = 'fares';
  }
</script>

<svelte:head>
  <title>Neoleo Ruta - Monterrey</title>
</svelte:head>

<main class="relative h-screen w-screen overflow-hidden bg-background-app">
  <MapLibreMap />
  <HamburgerMenu onAction={handleMenuAction} />

  <ActionPanel 
    isOpen={activePanel !== 'none'} 
    onClose={() => activePanel = 'none'}
    onBack={panelContent.onBack}
    title={panelContent.title}
    subtitle={panelContent.subtitle}
    items={panelContent.items}
    footerText={panelContent.footer}
  />

  <!-- Cross-fade: chat ↔ route card share the same bottom-sheet space -->
  <div class="chat-crossfade" class:chat-hidden={!!activeRoute}>
    <ChatInterface externalUserLocation={userLocation} externalLocationStatus={locationStatus} onLocationRequest={requestLocation} />
  </div>
  <RouteInfoCard route={activeRoute} onClose={closeRoute} />
  <LandmarkModal />
</main>

<style>
  .chat-crossfade {
    transition: opacity 350ms ease-out;
  }
  .chat-hidden {
    opacity: 0;
    pointer-events: none;
  }
</style>
