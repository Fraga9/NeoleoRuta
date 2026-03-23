<script lang="ts" context="module">
  export interface ActiveRouteInfo {
    baseId: string;
    hasDirections: boolean;
    direction: 'ida' | 'vuelta';
    label: string;
    color: string;
    fare: string;
    badge: string;
    stationsCount: number;
    firstStop: string;
    lastStop: string;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapStore } from '$lib/stores/mapStore';
  import { transitRoutes, type RouteId } from '$lib/data/transitRoutes';

  interface Props {
    route: ActiveRouteInfo | null;
    onClose: () => void;
  }

  let { route, onClose } = $props<Props>();

  // ── DOM refs ──
  let cardEl = $state<HTMLDivElement | null>(null);
  let stationsEl = $state<HTMLDivElement | null>(null);

  // Latched route — keeps content valid during the close spring
  let lm = $state<ActiveRouteInfo | null>(null);
  let visible = $state(false);
  let closing = $state(false);

  // ── Height-based snap points (same as ChatInterface) ──
  const COMPACT_H = 140;
  let halfH = $state(370);
  let fullH = $state(620);
  const BOTTOM_GAP = 12;

  function calcSnap() {
    if (!browser) return;
    halfH = Math.min(380, Math.round(window.innerHeight * 0.48));
    fullH = Math.round(window.innerHeight * 0.82);
  }

  // ── Card height (imperative for 60fps spring) ──
  let currentH = COMPACT_H;
  let cardHState = $state(COMPACT_H);

  function applyH(h: number) {
    currentH = h;
    if (cardEl) cardEl.style.height = h + 'px';
    const r = Math.round(h);
    if (Math.abs(cardHState - r) >= 1) cardHState = r;
  }

  onMount(() => {
    calcSnap();
    if (browser) window.addEventListener('resize', calcSnap);
  });

  onDestroy(() => {
    if (springRAF !== null) cancelAnimationFrame(springRAF);
    if (browser) {
      window.removeEventListener('resize', calcSnap);
      stopDrag();
    }
  });

  // ── Derived mode (from current height) ──
  const sheetMode = $derived.by(() => {
    const midLow = (COMPACT_H + halfH) / 2;
    const midHigh = (halfH + fullH) / 2;
    if (cardHState <= midLow) return 'compact' as const;
    if (cardHState <= midHigh) return 'half' as const;
    return 'full' as const;
  });

  let targetMode = $state<'compact' | 'half' | 'full'>('compact');

  // ── Spring physics (same constants as ChatInterface) ──
  let springVel = 0;
  let springRAF: ReturnType<typeof requestAnimationFrame> | null = null;

  function springTo(target: number, initVel = 0): Promise<void> {
    return new Promise((resolve) => {
      if (springRAF !== null) { cancelAnimationFrame(springRAF); springRAF = null; }
      targetMode = target >= fullH - 10 ? 'full' : target >= halfH - 10 ? 'half' : 'compact';
      springVel = initVel;
      const STIFFNESS = 320;
      const DAMPING = 32;

      function step() {
        const disp = target - currentH;
        const acc = STIFFNESS * disp - DAMPING * springVel;
        springVel += acc / 60;
        applyH(currentH + springVel / 60);
        if (Math.abs(springVel) > 0.3 || Math.abs(disp) > 0.5) {
          springRAF = requestAnimationFrame(step);
        } else {
          applyH(target);
          springVel = 0;
          springRAF = null;
          resolve();
        }
      }
      springRAF = requestAnimationFrame(step);
    });
  }

  // ── Drag via Pointer Events (same as ChatInterface) ──
  let isDragging = false;
  let dragBaseH = 0;
  let dragStartPY = 0;
  let velH = 0;
  let prevPY = 0;
  let prevPTime = 0;

  function rubberBand(excess: number) {
    return Math.sign(excess) * Math.log1p(Math.abs(excess)) * 14;
  }

  function onDragMove(e: PointerEvent) {
    if (!isDragging) return;
    const now = Date.now();
    const dt = now - prevPTime;
    if (dt > 0) velH = -(e.clientY - prevPY) / dt;
    prevPY = e.clientY;
    prevPTime = now;
    const raw = dragBaseH - (e.clientY - dragStartPY);
    if (raw > fullH) applyH(fullH + rubberBand(raw - fullH));
    else if (raw < COMPACT_H) applyH(COMPACT_H + rubberBand(raw - COMPACT_H));
    else applyH(raw);
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    stopDrag();
    const FLICK = 0.4;
    let target: number;
    if (velH > FLICK) target = sheetMode === 'compact' ? halfH : fullH;
    else if (velH < -FLICK) target = sheetMode === 'full' ? halfH : COMPACT_H;
    else {
      const dC = Math.abs(currentH - COMPACT_H);
      const dH = Math.abs(currentH - halfH);
      const dF = Math.abs(currentH - fullH);
      const min = Math.min(dC, dH, dF);
      target = min === dC ? COMPACT_H : min === dH ? halfH : fullH;
    }
    springTo(target, velH * 16.67);
  }

  function stopDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
  }

  function onHeaderPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    if (springRAF !== null) { cancelAnimationFrame(springRAF); springRAF = null; }
    isDragging = true;
    dragBaseH = currentH;
    dragStartPY = e.clientY;
    velH = 0;
    prevPY = e.clientY;
    prevPTime = Date.now();
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    e.preventDefault();
  }

  // ── Route state ──
  let dir = $state<'ida' | 'vuelta'>('ida');
  let allStations = $state<string[]>([]);

  function loadStations() {
    if (!lm) return;
    const id = lm.hasDirections ? `${lm.baseId}-${dir}` as RouteId : lm.baseId as RouteId;
    const r = transitRoutes[id];
    if (r) allStations = r.stations.map(s => s.name);
    else allStations = [];
  }

  // React to route prop changes
  $effect(() => {
    if (route && (!lm || route.baseId !== lm.baseId)) {
      lm = route;
      dir = route.direction;
      visible = true;
      loadStations();
      applyH(COMPACT_H);
      requestAnimationFrame(() => springTo(halfH));
    }
  });

  function switchDir(d: 'ida' | 'vuelta') {
    if (!lm || dir === d) return;
    dir = d;
    loadStations();
    const id = `${lm.baseId}-${d}` as RouteId;
    mapStore.clearRoutes();
    mapStore.drawRoute(id);
  }

  async function handleClose() {
    await springTo(COMPACT_H);
    closing = true;     // triggers scale-down + fade CSS
    setTimeout(() => {
      onClose();        // sets activeRoute = null → chat fades back in
    }, 180);
    setTimeout(() => {
      visible = false;
      closing = false;
      lm = null;
    }, 450);
  }
</script>

{#if visible && lm}
<div
  bind:this={cardEl}
  class="route-card fixed left-0 right-0 z-20 mx-auto flex flex-col overflow-hidden backdrop-blur-2xl
         {closing ? 'route-closing' : ''}"
  style="background:{lm.color};"
  style:bottom={targetMode === 'full' ? '0' : BOTTOM_GAP + 'px'}
  style:width={targetMode === 'full' ? '100%' : 'min(calc(100vw - 24px), 32rem)'}
  style:border-radius={targetMode === 'full' ? '1.25rem 1.25rem 0 0' : '1.75rem'}
  style:box-shadow={targetMode !== 'full'
    ? `0 -2px 28px ${lm.color}40, 0 4px 20px rgba(0,0,0,0.15)`
    : '0 -1px 4px rgba(0,0,0,0.12)'}
>
  <!-- ── Drag Header ── -->
  <div
    class="flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
    style="touch-action: none;"
    onpointerdown={onHeaderPointerDown}
    role="slider"
    aria-label="Expandir o colapsar panel"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={sheetMode === 'full' ? 100 : sheetMode === 'half' ? 50 : 0}
    tabindex="0"
  >
    <!-- Handle pill -->
    <div class="flex justify-center pt-2.5 pb-1">
      <div class="h-[5px] w-9 rounded-full bg-white/30"></div>
    </div>

    <!-- Brand row -->
    <div class="flex items-center justify-between px-5 pb-2.5 pt-0.5">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/15">
          <svg class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
        </div>
        <div class="min-w-0">
          <p class="text-[15px] font-bold leading-tight text-white truncate">{lm.label}</p>
          {#if sheetMode === 'compact'}
            <p class="text-[12px] leading-tight text-white/55">{lm.badge} · {lm.fare}</p>
          {:else}
            <p class="text-[12px] leading-tight text-white/55">{lm.badge} · <span class="font-bold text-white/80">{lm.fare}</span> · Me Muevo</p>
          {/if}
        </div>
      </div>

      <button
        onclick={handleClose}
        class="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 active:bg-white/25 transition-colors flex-shrink-0"
        aria-label="Cerrar"
      >
        <svg class="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- ── Direction Toggle ── -->
  {#if lm.hasDirections}
    <div class="flex-shrink-0 px-4 pb-3">
      <div class="flex p-1 rounded-xl bg-black/10">
        <button
          onclick={() => switchDir('ida')}
          class="flex-1 py-[9px] rounded-[0.6rem] text-[13px] font-semibold transition-all duration-200
                 {dir === 'ida' ? 'bg-white shadow-sm' : 'text-white/45'}"
          style={dir === 'ida' ? `color:${lm.color}` : ''}
        >
          → IDA
        </button>
        <button
          onclick={() => switchDir('vuelta')}
          class="flex-1 py-[9px] rounded-[0.6rem] text-[13px] font-semibold transition-all duration-200
                 {dir === 'vuelta' ? 'bg-white shadow-sm' : 'text-white/45'}"
          style={dir === 'vuelta' ? `color:${lm.color}` : ''}
        >
          VUELTA ←
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Scrollable Content ── -->
  <div
    bind:this={stationsEl}
    class="stations-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 overscroll-contain
           transition-opacity duration-200
           {sheetMode === 'compact' ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
    style="touch-action: pan-y;"
  >
    {#if sheetMode !== 'full'}
      <!-- Half mode: endpoint summary -->
      <div class="flex gap-3 px-1 pt-1">
        <div class="flex flex-col items-center pt-[3px]" style="min-height:72px">
          <div class="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0 border-white bg-transparent"></div>
          <div class="flex-1 w-[2px] my-1.5 rounded-full bg-white/25"></div>
          <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-white"></div>
        </div>
        <div class="flex flex-col justify-between flex-1">
          <span class="text-[14px] font-semibold text-white leading-tight">
            {allStations[0] ?? ''}
          </span>
          <span class="text-[11px] text-white/40 py-0.5">
            {allStations.length} estaciones
          </span>
          <span class="text-[14px] font-semibold text-white leading-tight">
            {allStations[allStations.length - 1] ?? ''}
          </span>
        </div>
      </div>
    {:else}
      <!-- Full mode: all stations list -->
      <div class="flex flex-col pt-1">
        {#each allStations as station, i}
          <div class="flex items-start gap-3">
            <div class="flex flex-col items-center flex-shrink-0" style="width:12px;">
              <div class="flex-shrink-0"
                   style="width:{i === 0 || i === allStations.length - 1 ? '10px' : '7px'};
                          height:{i === 0 || i === allStations.length - 1 ? '10px' : '7px'};
                          border-radius:50%;
                          margin-top:{i === 0 || i === allStations.length - 1 ? '2px' : '4px'};
                          {i === 0
                            ? 'border:2.5px solid white; background:transparent;'
                            : i === allStations.length - 1
                              ? 'background:white;'
                              : 'background:rgba(255,255,255,0.35);'}"
              ></div>
              {#if i < allStations.length - 1}
                <div class="w-[2px] rounded-full"
                     style="height:18px; background:rgba(255,255,255,0.15);"></div>
              {/if}
            </div>
            <span class="text-[13px] leading-tight pt-[2px]
                         {i === 0 || i === allStations.length - 1
                           ? 'font-semibold text-white'
                           : 'text-white/60'}">
              {station}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  .stations-scroll::-webkit-scrollbar { display: none; }
  .stations-scroll { -ms-overflow-style: none; scrollbar-width: none; }

  .route-card {
    transition:
      bottom        0.45s cubic-bezier(0.32, 0.72, 0, 1),
      width         0.45s cubic-bezier(0.32, 0.72, 0, 1),
      border-radius 0.45s cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow    0.3s ease,
      opacity       0.35s ease,
      transform     0.35s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .route-closing {
    opacity: 0;
    transform: scale(0.92) translateY(16px);
  }
</style>
