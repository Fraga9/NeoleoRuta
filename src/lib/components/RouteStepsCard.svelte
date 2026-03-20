<script lang="ts">
  import { haversineDistance } from '$lib/engine/raptorData';
  import { formatFare } from '$lib/data/fareRules';

  interface RouteStep {
    type: 'walk' | 'transit' | 'transfer';
    from: string;
    to: string;
    fromCoords: [number, number];
    toCoords: [number, number];
    duration: number;
    routeId?: string;
    stopsCount?: number;
    walkDistance?: number;
  }

  interface RoutePlan {
    origin: { name: string; coords: [number, number] };
    destination: { name: string; coords: [number, number] };
    totalDuration: number;
    steps: RouteStep[];
  }

  interface Props {
    plan: RoutePlan;
    totalFare?: number;
  }

  let { plan, totalFare } = $props<Props>();

  // ── Route metadata ──
  const ROUTE_META: Record<string, { color: string; label: string; short: string; mode: 'metro' | 'ecovia' | 'bus' }> = {
    'metro-1':         { color: '#E5A52B', label: 'Metro Línea 1', short: 'L1', mode: 'metro' },
    'metro-2':         { color: '#3A913F', label: 'Metro Línea 2', short: 'L2', mode: 'metro' },
    'metro-3':         { color: '#D44A1E', label: 'Metro Línea 3', short: 'L3', mode: 'metro' },
    'ecovia':          { color: '#B61F34', label: 'Ecovía',         short: 'ECV', mode: 'ecovia' },
  };

  function getRouteMeta(routeId?: string) {
    if (!routeId) return { color: '#6B7280', label: 'Transporte', short: '?', mode: 'bus' as const };
    if (ROUTE_META[routeId]) return ROUTE_META[routeId];
    // Bus route: 'ruta-220-pedregal-ida' → 'Ruta 220'
    const numMatch = routeId.match(/ruta-(\d+)/);
    const num = numMatch ? numMatch[1] : routeId;
    return { color: '#285A71', label: `Ruta ${num}`, short: num, mode: 'bus' as const };
  }

  function fmtDist(step: RouteStep): string {
    const d = step.walkDistance ?? Math.round(haversineDistance(step.fromCoords, step.toCoords) * 1.25);
    return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
  }

  function isTaxi(step: RouteStep): boolean {
    return haversineDistance(step.fromCoords, step.toCoords) > 1500;
  }

  // Merge consecutive steps into timeline nodes
  // A "node" = a location dot, between two steps
</script>

<div class="route-card rounded-[1.5rem] overflow-hidden bg-white border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.08)]">

  <!-- Header strip: origin → destination + total time -->
  <div class="flex items-center justify-between px-4 py-3 bg-primary/[0.05] border-b border-black/[0.05]">
    <div class="min-w-0 flex-1">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-primary/50 leading-none mb-0.5">Ruta calculada</p>
      <p class="text-[13px] font-semibold text-primary leading-tight truncate">
        {plan.origin.name} → {plan.destination.name}
      </p>
    </div>
    <div class="flex-shrink-0 ml-3 flex items-center gap-1.5">
      <div class="flex items-center gap-1 rounded-full bg-primary px-3 py-1">
        <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span class="text-[12px] font-bold text-white">{plan.totalDuration} min</span>
      </div>
      {#if totalFare !== undefined}
        <div class="flex items-center gap-1 rounded-full bg-[#CFDA5A]/80 px-2.5 py-1">
          <span class="text-[12px] font-bold text-primary">{formatFare(totalFare)}</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- Step timeline -->
  <div class="px-4 py-3">
    <!-- Origin dot -->
    <div class="flex items-start gap-3 mb-1">
      <div class="flex flex-col items-center flex-shrink-0 w-7">
        <div class="h-3 w-3 rounded-full bg-primary border-2 border-primary ring-2 ring-primary/20"></div>
      </div>
      <p class="text-[13px] font-semibold text-primary/80 leading-tight pb-1 -mt-0.5">{plan.origin.name}</p>
    </div>

    {#each plan.steps as step, i}
      {@const isLast = i === plan.steps.length - 1}

      {#if step.type === 'walk'}
        {@const taxi = isTaxi(step)}
        <!-- Walk / Taxi connector -->
        <div class="flex items-stretch gap-3">
          <!-- Timeline line + icon -->
          <div class="flex flex-col items-center flex-shrink-0 w-7">
            <div class="w-0.5 flex-1 bg-[#D1D5DB]"></div>
            <div class="my-1 flex h-6 w-6 items-center justify-center rounded-full {taxi ? 'bg-[#FEF3C7]' : 'bg-[#F3F4F6]'}">
              {#if taxi}
                <svg class="w-3.5 h-3.5 text-[#92400E]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.08 3.11H5.77L6.85 7zM19 17H5v-5h14v5z"/>
                  <circle cx="7.5" cy="14.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/>
                </svg>
              {:else}
                <svg class="w-3.5 h-3.5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              {/if}
            </div>
            <div class="w-0.5 flex-1 bg-[#D1D5DB]"></div>
          </div>
          <!-- Content -->
          <div class="flex-1 py-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[12px] font-semibold {taxi ? 'text-[#92400E]' : 'text-[#6B7280]'}">
                {taxi ? 'Taxi / Uber' : 'Caminar'}
              </span>
              <span class="text-[11px] font-medium text-[#9CA3AF]">{step.duration} min</span>
            </div>
            {#if !taxi}
              <span class="text-[11px] text-[#9CA3AF]">{fmtDist(step)}</span>
            {/if}
          </div>
        </div>

        <!-- Intermediate station dot (if next step is transit/transfer) -->
        {#if !isLast}
          <div class="flex items-start gap-3 mb-1">
            <div class="flex flex-col items-center flex-shrink-0 w-7">
              {#if step.type === 'walk' && plan.steps[i + 1]?.type === 'transit'}
                {@const nextMeta = getRouteMeta(plan.steps[i + 1].routeId)}
                <div class="h-2.5 w-2.5 rounded-full border-2 border-white ring-1.5"
                     style="background: {nextMeta.color}; box-shadow: 0 0 0 2px {nextMeta.color}30">
                </div>
              {:else}
                <div class="h-2 w-2 rounded-full bg-[#D1D5DB]"></div>
              {/if}
            </div>
            <p class="text-[12px] text-[#6B7280] leading-tight -mt-0.5">{step.to}</p>
          </div>
        {/if}

      {:else if step.type === 'transit'}
        {@const meta = getRouteMeta(step.routeId)}
        <!-- Transit segment -->
        <div class="flex items-stretch gap-3 my-0.5">
          <!-- Timeline: colored line -->
          <div class="flex flex-col items-center flex-shrink-0 w-7">
            <div class="w-[3px] flex-1 rounded-full" style="background: {meta.color};"></div>
          </div>
          <!-- Transit card -->
          <div class="flex-1 my-1 rounded-xl overflow-hidden border border-black/[0.05]"
               style="background: {meta.color}14;">
            <!-- Route badge + name -->
            <div class="flex items-center gap-2 px-3 py-2 border-b border-black/[0.05]">
              <span class="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white leading-none"
                    style="background: {meta.color};">{meta.short}</span>
              <span class="text-[13px] font-semibold" style="color: {meta.color};">{meta.label}</span>
              <span class="ml-auto text-[11px] font-medium text-[#9CA3AF]">{step.duration} min</span>
            </div>
            <!-- From → To -->
            <div class="flex items-center gap-1.5 px-3 py-1.5">
              <span class="text-[11px] text-[#6B7280] truncate max-w-[100px]">{step.from}</span>
              <svg class="w-3 h-3 text-[#9CA3AF] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
              </svg>
              <span class="text-[11px] text-[#6B7280] truncate max-w-[100px]">{step.to}</span>
              {#if step.stopsCount}
                <span class="ml-auto flex-shrink-0 text-[11px] text-[#9CA3AF]">{step.stopsCount} paradas</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- Station dot after transit -->
        {#if !isLast}
          {@const nextStep = plan.steps[i + 1]}
          <div class="flex items-start gap-3 mb-1">
            <div class="flex flex-col items-center flex-shrink-0 w-7">
              {#if nextStep?.type === 'transit'}
                {@const nm = getRouteMeta(nextStep.routeId)}
                <div class="h-2.5 w-2.5 rounded-full border-2 border-white"
                     style="background: {nm.color}; box-shadow: 0 0 0 2px {nm.color}30;">
                </div>
              {:else}
                <div class="h-2.5 w-2.5 rounded-full border-2 border-[#D1D5DB] bg-white"></div>
              {/if}
            </div>
            <p class="text-[12px] text-[#6B7280] leading-tight -mt-0.5">{step.to}</p>
          </div>
        {/if}

      {:else if step.type === 'transfer'}
        <!-- Transfer connector -->
        <div class="flex items-stretch gap-3">
          <div class="flex flex-col items-center flex-shrink-0 w-7">
            <div class="w-0.5 flex-1 bg-[#E5E7EB] border-l-2 border-dashed border-[#D1D5DB]"></div>
            <div class="my-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#F9FAFB] border border-[#E5E7EB]">
              <svg class="w-3.5 h-3.5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
              </svg>
            </div>
            <div class="w-0.5 flex-1 bg-[#E5E7EB]"></div>
          </div>
          <div class="flex-1 py-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[12px] font-semibold text-[#9CA3AF]">Transbordo</span>
              <span class="text-[11px] font-medium text-[#9CA3AF]">{step.duration} min</span>
            </div>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Destination dot -->
    <div class="flex items-start gap-3 mt-1">
      <div class="flex flex-col items-center flex-shrink-0 w-7">
        <div class="h-3.5 w-3.5 rounded-full bg-primary flex items-center justify-center">
          <div class="h-1.5 w-1.5 rounded-full bg-white"></div>
        </div>
      </div>
      <p class="text-[13px] font-semibold text-primary/80 leading-tight -mt-0.5">{plan.destination.name}</p>
    </div>
  </div>
</div>
