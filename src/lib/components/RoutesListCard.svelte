<script lang="ts" module>
  export interface RouteNearby {
    routeId: string;
    label: string;
    color: string;
    nearestStop: string;
    nearestStopCoords: [number, number];
    distanceToLocation: number;
    distanceToUser?: number;
    type: 'metro' | 'ecovia' | 'bus';
  }

  export interface RoutesListData {
    location: string;
    coords: [number, number];
    routes: RouteNearby[];
    filter?: 'metro' | 'ecovia' | 'bus' | null;
  }
</script>

<script lang="ts">
  interface Props {
    data: RoutesListData;
    onRouteSelect?: (route: RouteNearby) => void;
  }

  let { data, onRouteSelect } = $props<Props>();

  function formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
  }

  function getTypeLabel(type: 'metro' | 'ecovia' | 'bus'): string {
    switch (type) {
      case 'metro': return 'Metro';
      case 'ecovia': return 'Ecovía';
      case 'bus': return 'Camión';
    }
  }

  const count = data.routes.length;
  const typeText = data.filter 
    ? getTypeLabel(data.filter).toLowerCase() + (count !== 1 ? (data.filter === 'bus' ? 'es' : 's') : '')
    : (count === 1 ? 'ruta' : 'rutas');
</script>

<div class="routes-list-card w-full rounded-[1.5rem] overflow-hidden bg-white border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col">
  <!-- Header strip -->
  <div class="flex items-center justify-between px-4 py-3 bg-primary/[0.05] border-b border-black/[0.05]">
    <div class="min-w-0 flex-1">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-primary/50 leading-none mb-1">Rutas cercanas</p>
      <p class="text-[13px] font-semibold text-primary leading-tight truncate">
        {data.location}
      </p>
    </div>
    <div class="flex items-center gap-2 ml-3">
      <div class="bg-primary/10 px-2 py-1 rounded-lg">
        <span class="text-[11px] font-bold text-primary">{count} {typeText}</span>
      </div>
    </div>
  </div>

  <!-- Routes list -->
  <div class="max-h-[320px] overflow-y-auto px-3 py-2 space-y-2 custom-scrollbar">
    {#if data.routes.length === 0}
      <div class="py-8 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-black/[0.03] mb-2 text-black/20">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
        </div>
        <p class="text-[13px] font-medium text-black/40">No se encontraron rutas cerca</p>
      </div>
    {:else}
      {#each data.routes as route (route.routeId)}
        <button 
          onclick={() => onRouteSelect?.(route)}
          class="w-full text-left flex items-stretch gap-3 rounded-xl border border-black/[0.05] overflow-hidden transition-all hover:border-black/[0.1] active:scale-[0.98]"
          style="background: {route.color}08;"
        >
          <!-- Color accent strip -->
          <div class="w-1.5 flex-shrink-0" style="background: {route.color};"></div>
          
          <div class="flex-1 py-2.5 pr-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-0.5">
                <span class="text-[14px] font-bold text-black/80 truncate">{route.label}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/5 text-black/40 uppercase">
                  {getTypeLabel(route.type)}
                </span>
              </div>
              <div class="flex items-center gap-1.5 text-[11px] text-black/40">
                <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                <span class="truncate">Parada: {route.nearestStop}</span>
              </div>
            </div>

            <div class="flex flex-col items-end gap-0.5 flex-shrink-0">
              <span class="text-[12px] font-bold text-black/70">{formatDistance(route.distanceToLocation)}</span>
              {#if route.distanceToUser !== undefined}
                <span class="text-[10px] text-black/30 font-medium whitespace-nowrap">A {formatDistance(route.distanceToUser)} de ti</span>
              {/if}
            </div>
            
            <svg class="w-4 h-4 text-black/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { width: 4px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { 
    background: rgba(0,0,0,0.05); 
    border-radius: 10px;
  }
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(0,0,0,0.05) transparent;
  }
</style>
