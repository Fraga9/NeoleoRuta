<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { marked } from 'marked';
  import { tick, onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapStore } from '$lib/stores/mapStore';
  import type { RouteId } from '$lib/data/transitRoutes';
  import RouteStepsCard from './RouteStepsCard.svelte';
  import RouteOptionsTabs from './RouteOptionsTabs.svelte';
  import RoutesListCard, { type RoutesListData, type RouteNearby } from './RoutesListCard.svelte';
  import { calcTotalFare } from '$lib/data/fareRules';
  import { landmarkStore } from '$lib/stores/landmarkStore';

  marked.setOptions({ breaks: true });

  interface Props {
    externalUserLocation: [number, number] | null;
    externalLocationStatus: 'idle' | 'requesting' | 'granted' | 'denied';
    onLocationRequest: () => void;
    hidden?: boolean;
  }

  let {
    externalUserLocation: userLocation,
    externalLocationStatus: locationStatus,
    onLocationRequest: requestLocation,
    hidden = false,
  } = $props<Props>();

  // ── DOM refs ──
  let cardEl = $state<HTMLDivElement | null>(null);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let isInputFocused = $state(false);

  // ── Height-based snap points (px) ──
  // Card is anchored at bottom:BOTTOM_GAP+kbOffset and grows UPWARD.
  // This way rounded bottom corners are always visible — true floating.
  const COMPACT_H = 140;
  let halfH = $state(370);
  let fullH = $state(620);
  const BOTTOM_GAP = 12; // always 12px from the visible viewport bottom

  // Keyboard offset: how many px the visible viewport bottom is above window bottom.
  // On iOS Safari, innerHeight stays fixed; visualViewport.height shrinks with keyboard.
  // On Android/Chrome both shrink, but visualViewport is still the right source.
  let kbOffset = $state(0);

  function getVpHeight(): number {
    return window.visualViewport?.height ?? window.innerHeight;
  }

  function calcSnap() {
    if (!browser) return;
    const h = getVpHeight();
    halfH = Math.min(380, Math.round(h * 0.48));
    fullH = Math.round(h * 0.82);
  }

  function onVpResize() {
    if (!browser) return;
    const vp = window.visualViewport;
    if (vp) {
      // kbOffset = space between visible viewport bottom and window bottom
      kbOffset = Math.max(0, window.innerHeight - vp.height - vp.offsetTop);
    }
    calcSnap();
    // If input is focused and keyboard just opened, ensure at least half mode
    if (kbOffset > 80 && sheetMode === 'compact') springTo(halfH);
  }

  // ── Card height (direct DOM, not $state, for 60fps spring) ──
  let currentH = COMPACT_H;
  let cardHState = $state(COMPACT_H); // reactive copy for mode detection

  function applyH(h: number) {
    currentH = h;
    if (cardEl) cardEl.style.height = h + 'px';
    const r = Math.round(h);
    if (Math.abs(cardHState - r) >= 1) cardHState = r;
  }

  onMount(() => {
    calcSnap();
    applyH(COMPACT_H);
    targetMode = 'compact';
    // visualViewport covers both keyboard resize and URL bar changes.
    // Falls back to window resize for browsers without visualViewport support.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onVpResize);
      window.visualViewport.addEventListener('scroll', onVpResize);
    } else {
      window.addEventListener('resize', calcSnap);
    }
  });

  onDestroy(() => {
    if (springRAF !== null) cancelAnimationFrame(springRAF);
    if (browser) {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onVpResize);
        window.visualViewport.removeEventListener('scroll', onVpResize);
      } else {
        window.removeEventListener('resize', calcSnap);
      }
      stopDrag();
    }
  });

  // ── Derived mode (from current height, used for content visibility) ──
  const sheetMode = $derived.by(() => {
    const midLow = (COMPACT_H + halfH) / 2;
    const midHigh = (halfH + fullH) / 2;
    if (cardHState <= midLow) return 'compact' as const;
    if (cardHState <= midHigh) return 'half' as const;
    return 'full' as const;
  });

  // targetMode: set at snap TARGET start — drives geometry CSS transitions.
  // Separate from sheetMode so geometry doesn't jump mid-spring-animation.
  let targetMode = $state<'compact' | 'half' | 'full'>('compact');

  // ── Spring physics (animates height) ──
  let springVel = 0;
  let springRAF: ReturnType<typeof requestAnimationFrame> | null = null;

  function springTo(target: number, initVel = 0) {
    if (springRAF !== null) { cancelAnimationFrame(springRAF); springRAF = null; }
    // Commit geometry target IMMEDIATELY so CSS transitions start in sync with spring
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
      }
    }
    springRAF = requestAnimationFrame(step);
  }

  // ── Drag via Pointer Events ──
  // Drag UP → height increases (expand)
  // Drag DOWN → height decreases (collapse)
  let isDragging = false;
  let dragBaseH = 0;
  let dragStartPY = 0;
  let velH = 0; // positive = expanding (moving up = negative Y delta)
  let prevPY = 0;
  let prevPTime = 0;

  function rubberBand(excess: number) {
    return Math.sign(excess) * Math.log1p(Math.abs(excess)) * 14;
  }

  function onDragMove(e: PointerEvent) {
    if (!isDragging) return;
    const now = Date.now();
    const dt = now - prevPTime;
    // velH: positive = expanding. Dragging UP (negative deltaY) = expanding.
    if (dt > 0) velH = -(e.clientY - prevPY) / dt;
    prevPY = e.clientY;
    prevPTime = now;

    const raw = dragBaseH - (e.clientY - dragStartPY);
    if (raw > fullH) applyH(fullH + rubberBand(raw - fullH));
    else if (raw < COMPACT_H) applyH(COMPACT_H + rubberBand(raw - COMPACT_H));
    else applyH(raw);
  }

  function onDragEnd(_e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    stopDrag();

    const FLICK = 0.4; // px/ms
    let target: number;

    if (velH > FLICK) {
      // Fast flick upward → expand one step
      target = sheetMode === 'compact' ? halfH : fullH;
    } else if (velH < -FLICK) {
      // Fast flick downward → collapse one step
      target = sheetMode === 'full' ? halfH : COMPACT_H;
    } else {
      const dC = Math.abs(currentH - COMPACT_H);
      const dH = Math.abs(currentH - halfH);
      const dF = Math.abs(currentH - fullH);
      const min = Math.min(dC, dH, dF);
      target = min === dC ? COMPACT_H : min === dH ? halfH : fullH;
    }

    // initVel: positive = expanding velocity
    springTo(target, velH * 16.67);
  }

  function stopDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
  }

  function onHeaderPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('input, button')) return;
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

  // ── Auto-expand on stream ──
  $effect(() => {
    if ((chat.messages.length > 0 || routeMessages.length > 0) && isStreaming && sheetMode === 'compact') {
      springTo(halfH);
    }
  });

  // ── Route plan state ──
  let currentRoutePlan = $state<any>(null);

  // ── Disambiguation state ──
  let pendingClarification = $state<{
    field: 'origin' | 'destination' | 'location';
    original: string;
    candidates: Array<{ label: string; coords: [number, number] }>;
    partialIntent: Record<string, any>;
    queryType?: 'route' | 'routes-near';
    filter?: 'metro' | 'ecovia' | 'bus' | null;
  } | null>(null);

  const chat = new Chat({ api: '/api/chat' } as any);
  let routeMessages = $state<Array<{
    id: string;
    role: string;
    text: string;
    plan?: any;
    alternatives?: any[];
    candidates?: Array<{ label: string; coords: [number, number] }>;
    routesList?: RoutesListData;
  }>>([]);

  let input = $state('');
  const isStreaming = $derived(chat.status === 'streaming' || chat.status === 'submitted');
  let isRouteLoading = $state(false);

  // Track when each message ID is first seen to sort both arrays chronologically.
  // Plain Map (not reactive) — intentional: we only need it to influence the $derived sort.
  const msgFirstSeen = new Map<string, number>();
  function msgTs(id: string): number {
    if (!msgFirstSeen.has(id)) msgFirstSeen.set(id, Date.now());
    return msgFirstSeen.get(id)!;
  }

  const allMessages = $derived.by(() => {
    const routeMsgs = routeMessages.map(m => ({ ...m, source: 'route' as const, _ts: msgTs(m.id) }));
    const chatMsgs = chat.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      text: m.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n\n') || m.content || '',
      source: 'chat' as const,
      _ts: msgTs(m.id),
    }));
    return [...routeMsgs, ...chatMsgs].sort((a, b) => a._ts - b._ts);
  });

  const lastAssistantPreview = $derived.by(() => {
    const msgs = allMessages.filter(m => m.role === 'assistant');
    if (!msgs.length) return '';
    return msgs[msgs.length - 1].text
      .replace(/[*#_`\[\]()]/g, '').replace(/\n/g, ' ').trim().slice(0, 55);
  });

  async function scrollToBottom() {
    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  $effect(() => { allMessages; scrollToBottom(); });

  async function consumeSSE(body: ReadableStream<Uint8Array>): Promise<boolean> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantMsgId = '';
    let nlgText = '';
    let gotPlan = false;
    let gotRoute = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let eventEnd: number;
      while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        const eventMatch = rawEvent.match(/^event:\s*(.+)\ndata:\s*(.+)$/s);
        if (!eventMatch) continue;
        const [, eventType, dataStr] = eventMatch;
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (eventType === 'plan') {
          gotPlan = true;
          currentRoutePlan = data.plan;
          applyRoutePlan(data.plan);
          isRouteLoading = false;
          assistantMsgId = `assistant-${Date.now()}`;
          routeMessages = [...routeMessages, { id: assistantMsgId, role: 'assistant', text: '...', plan: data.plan, alternatives: data.alternatives ?? [] }];
          gotRoute = true;
        } else if (eventType === 'nlg-chunk' && assistantMsgId) {
          nlgText += data.text;
          routeMessages = routeMessages.map(m =>
            m.id === assistantMsgId ? { ...m, text: nlgText } : m
          );
        } else if (eventType === 'clarification') {
          isRouteLoading = false;
          pendingClarification = {
            field: data.field, original: data.original,
            candidates: data.candidates, partialIntent: data.partialIntent ?? {},
            queryType: data.queryType, filter: data.filter,
          };
          routeMessages = [...routeMessages, {
            id: `assistant-${Date.now()}`, role: 'assistant',
            text: `Encontré varias opciones para "${data.original}" como ${data.field === 'destination' ? 'destino' : data.field === 'origin' ? 'origen' : 'ubicación'}:`,
            candidates: data.candidates,
          }];
          gotRoute = true;
        } else if (eventType === 'routes-list') {
          // Feature 1: Store as a message so it persists in chat history
          isRouteLoading = false;
          const rlId = `assistant-${Date.now()}`;
          routeMessages = [...routeMessages, {
            id: rlId, role: 'assistant', text: '',
            routesList: { location: data.location, coords: data.coords, routes: data.routes, filter: data.filter },
          }];
          gotRoute = true;
        } else if (eventType === 'done') {
          const id = `assistant-${Date.now()}`;
          if (!gotPlan && !pendingClarification && data?.nlgText)
            routeMessages = [...routeMessages, { id, role: 'assistant', text: data.nlgText }];
          else if (!gotPlan && !pendingClarification && data?.error)
            routeMessages = [...routeMessages, { id, role: 'assistant', text: data.error }];
        }
      }
    }
    return gotRoute;
  }

  async function selectCandidate(index: number) {
    if (!pendingClarification) return;
    const candidate = pendingClarification.candidates[index];
    if (!candidate) return;

    routeMessages = [...routeMessages, { id: `user-${Date.now()}`, role: 'user', text: candidate.label }];
    const clarPayload: any = {
      field: pendingClarification.field, selectedCoords: candidate.coords,
      selectedLabel: candidate.label, partialIntent: pendingClarification.partialIntent,
    };
    // For routes-near location clarification, include metadata so the server
    // can run findRoutesNearPoint instead of routing
    if (pendingClarification.queryType === 'routes-near') {
      clarPayload.queryType = 'routes-near';
      clarPayload.filter = pendingClarification.filter;
    }
    pendingClarification = null;
    isRouteLoading = true;
    mapStore.clearRoutes();
    try {
      const body: any = { message: '', clarification: clarPayload };
      if (userLocation) body.userLocation = userLocation;
      const resp = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (resp.ok && resp.body) await consumeSSE(resp.body);
    } catch (e) { console.error('[CLIENT] Clarification error:', e); }
    isRouteLoading = false;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || isRouteLoading) return;
    const userMessage = input.trim();
    input = '';

    if (pendingClarification) {
      const numMatch = userMessage.match(/^(?:la\s+)?(\d+)$/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1]) - 1;
        if (idx >= 0 && idx < pendingClarification.candidates.length) { await selectCandidate(idx); return; }
      }
      pendingClarification = null;
    }

    mapStore.clearRoutes();
    currentRoutePlan = null;
    if (sheetMode === 'compact') springTo(halfH);

    const userMsgId = `user-${Date.now()}`;
    routeMessages = [...routeMessages, { id: userMsgId, role: 'user', text: userMessage }];
    isRouteLoading = true;

    try {
      const body: any = { message: userMessage };
      if (userLocation) body.userLocation = userLocation;
      const resp = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (resp.ok && resp.body) {
        const gotRoute = await consumeSSE(resp.body);
        if (gotRoute) { isRouteLoading = false; return; }
      }
    } catch (e) { console.error('[CLIENT] Route error:', e); }

    isRouteLoading = false;
    routeMessages = routeMessages.filter(m => m.id !== userMsgId);
    chat.sendMessage({ text: userMessage });
  }

  function applyRoutePlan(plan: any) {
    mapStore.applyPlan({
      routes: plan.linesUsed,
      origin: { name: plan.origin.name, coordinates: plan.origin.coords },
      destination: { name: plan.destination.name, coordinates: plan.destination.coords },
      boardingStations: plan.boardingStations,
      alightingStations: plan.alightingStations,
      walkGeometries: plan.steps
        .filter((s: any) => s.type === 'walk' && s.walkGeometry)
        .map((s: any) => s.walkGeometry),
    });
  }

  function submitSuggestion(text: string) {
    input = text;
    handleSubmit(new Event('submit') as any);
  }

  // Consume route requests triggered from LandmarkModal
  const unsubLandmark = landmarkStore.subscribe(s => {
    if (!s.pendingRouteQuery || isStreaming || isRouteLoading) return;
    const query = s.pendingRouteQuery;
    landmarkStore.clearRoute();
    submitSuggestion(query);
    // Delay spring so the modal sheet finishes flying out before we rise
    if (sheetMode === 'compact') setTimeout(() => springTo(halfH), 200);
  });

  onDestroy(unsubLandmark);
</script>

<!--
  Card is anchored at bottom:{BOTTOM_GAP}px always.
  Height is spring-animated from COMPACT_H → halfH → fullH.
  Rounded bottom corners are always visible → true floating effect.

  In full mode: card expands to near-full screen, switches to full-width with no horizontal margin.
-->
<!--
  style: directives set individual CSS properties — they do NOT overwrite the entire
  style attribute, so cardEl.style.height (set imperatively by spring) is preserved.
  Do NOT add style:height here.
-->
<!--
  Centering via left:0 right:0 + margin:auto — no translateX so no horizontal slide.
  Only width and border-radius animate between floating and full modes.
-->
<div
  bind:this={cardEl}
  class="sheet-card fixed left-0 right-0 z-20 mx-auto flex flex-col overflow-hidden bg-surface-container-highest/97 backdrop-blur-2xl"
  style:visibility={hidden ? 'hidden' : 'visible'}
  style:pointer-events={hidden ? 'none' : 'auto'}
  style:bottom={targetMode === 'full' ? kbOffset + 'px' : kbOffset + BOTTOM_GAP + 'px'}
  style:width={targetMode === 'full' ? '100%' : 'min(calc(100vw - 24px), 32rem)'}
  style:border-radius={targetMode === 'full' ? '1.75rem 1.75rem 0 0' : '1.75rem'}
  style:box-shadow={targetMode !== 'full'
    ? 'var(--shadow-elevation-3)'
    : 'var(--shadow-elevation-1)'}
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
    <div class="flex justify-center pt-3 pb-1">
      <div class="h-[5px] w-10 rounded-full bg-on-primary-container/25"></div>
    </div>

    <!-- Brand + Status row -->
    <div class="flex items-center justify-between px-5 pb-3 pt-1 w-full">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
        </div>
        <div class="min-w-0 flex flex-col justify-center">
          <p class="text-[16px] font-bold leading-tight text-on-surface tracking-tight mb-0.5">NeoLeo Ruta</p>
          {#if allMessages.length > 0 && sheetMode === 'compact'}
            <p class="max-w-[190px] truncate text-[13px] leading-tight text-on-surface/50">
              {isRouteLoading || isStreaming ? 'Calculando ruta...' : lastAssistantPreview}
            </p>
          {:else if sheetMode === 'compact'}
            <p class="text-[12px] font-medium leading-tight text-on-surface/40 tracking-wide">Monterrey · Movilidad</p>
          {/if}
        </div>
      </div>

      {#if allMessages.length > 0 && sheetMode === 'compact'}
        <button
          onclick={() => springTo(halfH)}
          class="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-primary-container active:bg-primary/20 transition-colors"
        >
          <span class="text-[12px] font-bold text-on-primary-container">{allMessages.length} msg</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- ── Search Bar ── -->
  <div class="flex-shrink-0 px-4 pb-3 w-full">
    <form onsubmit={handleSubmit}>
      <div
        class="relative flex items-center rounded-[20px] transition-all duration-300"
        style="background: {isInputFocused ? 'var(--color-surface)' : 'rgba(40,90,113,0.07)'}; box-shadow: {isInputFocused ? '0 8px 32px -8px rgba(0, 0, 0, 0.1)' : 'inset 0 2px 4px rgba(0,0,0,0.02)'}; border: 1px solid {isInputFocused ? 'rgba(0,0,0,0.05)' : 'transparent'};"
      >
        <svg class="pointer-events-none absolute left-3.5 h-[18px] w-[18px] text-on-surface/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          type="text"
          bind:this={inputEl}
          bind:value={input}
          disabled={isStreaming}
          onfocus={() => {
            isInputFocused = true;
            if (sheetMode === 'compact') springTo(halfH);
          }}
          onblur={() => { isInputFocused = false; }}
          placeholder="¿A dónde vamos hoy?"
          class="w-full bg-transparent py-[12px] pl-11 pr-12 text-[16px] font-medium text-on-surface placeholder-on-surface/30 focus:outline-none"
        />
        {#if input.trim()}
          <button
            type="submit"
            disabled={isStreaming || isRouteLoading}
            class="absolute right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/20 transition-all duration-150 active:scale-90 disabled:opacity-40"
          >
            {#if isStreaming || isRouteLoading}
              <span class="flex gap-0.5">
                <span class="h-1 w-1 animate-bounce rounded-full bg-white"></span>
                <span class="h-1 w-1 animate-bounce rounded-full bg-white [animation-delay:100ms]"></span>
              </span>
            {:else}
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            {/if}
          </button>
        {/if}
      </div>
    </form>
  </div>

  <!-- ── Scrollable Content ── -->
  <div
    bind:this={messagesEl}
    class="messages-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 overscroll-contain
           transition-opacity duration-300
           {sheetMode === 'compact' ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
    style="touch-action: pan-y;"
  >
    {#if allMessages.length === 0}
      <div class="px-2 pt-1 pb-4 w-full">
        <p class="mb-4 pl-1 text-[16px] font-extrabold tracking-tight text-on-surface">Explora Monterrey</p>
        <div class="grid grid-cols-3 gap-3 md:gap-4">
          <!-- 1: Estadio BBVA (Purple) -->
          <button
            onclick={() => submitSuggestion('Estadio BBVA')}
            class="col-span-1 rounded-[24px] bg-[#8953D6] p-4 flex flex-col justify-between items-start aspect-square max-h-[160px] md:max-h-[180px] w-full shadow-sm transition-transform active:scale-95 text-white group"
          >
            <div class="p-2 rounded-full bg-white/20 transition-transform group-hover:scale-110">
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <rect x="2" y="4" width="20" height="16" rx="6"/><rect x="5" y="7" width="14" height="10"/><line x1="12" y1="7" x2="12" y2="17"/><circle cx="12" cy="12" r="2"/><rect x="5" y="9.5" width="3" height="5"/><rect x="16" y="9.5" width="3" height="5"/>
              </svg>
            </div>
            <span class="text-[14px] font-bold leading-tight mt-2 text-left">Estadio<br/>BBVA</span>
          </button>

          <!-- 2: Pabellón M (Orange) -->
          <button
            onclick={() => submitSuggestion('Pabellón M')}
            class="col-span-2 rounded-[24px] bg-[#FF9A00] p-4 flex flex-col justify-between items-start shadow-sm transition-transform active:scale-95 text-white group relative overflow-hidden h-full max-h-[160px] md:max-h-[180px] w-full"
          >
            <div class="w-full flex justify-between items-start relative z-10">
              <div class="p-2 rounded-full bg-white/20 transition-transform group-hover:scale-110">
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2v2z"/><line x1="9" y1="4" x2="9" y2="20"/>
                </svg>
              </div>
            </div>
            <svg class="w-24 h-24 text-white/10 absolute right-[-14px] top-[-14px]" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/>
            </svg>
            <span class="text-[15px] font-bold mt-2 relative z-10">Pabellón M</span>
          </button>

          <!-- 3: Fundidora (Yellow) -->
          <button
            onclick={() => submitSuggestion('Parque Fundidora')}
            class="col-span-2 rounded-[24px] bg-[#FFC700] p-4 flex flex-col justify-between items-start shadow-sm transition-transform active:scale-95 text-white group relative overflow-hidden h-full max-h-[160px] md:max-h-[180px] w-full"
          >
            <div class="w-full flex justify-between items-start relative z-10">
              <div class="p-2 rounded-full bg-white/30 text-white transition-transform group-hover:scale-110">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                  <path d="M8 22V10l4-8 4 8v12H8z"/><line x1="6" y1="22" x2="18" y2="22"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="19" x2="15" y2="19"/>
                </svg>
              </div>
            </div>
            <svg class="w-24 h-24 text-white/20 absolute right-[-14px] top-[-14px]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2ZM12 4A8 8 0 0 1 20 12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4Z"/>
            </svg>
            <span class="text-[15px] font-bold text-white mt-2 relative z-10">Parque Fundidora</span>
          </button>

          <!-- 4: Macroplaza (Green) -->
          <button
            onclick={() => submitSuggestion('Macroplaza')}
            class="col-span-1 rounded-[24px] bg-[#53B927] p-4 flex flex-col justify-between items-start aspect-square max-h-[160px] md:max-h-[180px] w-full shadow-sm transition-transform active:scale-95 text-white group"
          >
            <div class="p-2 rounded-full bg-white/20 transition-transform group-hover:scale-110">
              <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="10" y="2" width="4" height="20" rx="0.5"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="10" y1="13" x2="14" y2="13"/><line x1="7" y1="22" x2="17" y2="22"/>
              </svg>
            </div>
            <span class="text-[14px] font-bold leading-tight mt-2 text-left">Macro-<br/>plaza</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-4 pt-2 w-full">
        {#each allMessages as message (message.id)}
          <div class="flex flex-col {message.role === 'user' ? 'items-end' : 'items-start'}">
            {#if message.role === 'user'}
              <div class="max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed bg-primary text-on-primary rounded-[1.25rem] rounded-tr-md shadow-lg shadow-primary/10">
                {message.text}
              </div>
            {:else if 'routesList' in message && message.routesList}
              <div class="w-full max-w-[92%]">
                <RoutesListCard
                  data={message.routesList}
                  onRouteSelect={(route) => console.log('[ROUTES-LIST] Selected:', route)}
                />
              </div>
            {:else if 'plan' in message && message.plan}
              <!-- Route response: short greeting + visual step card -->
              <div class="w-full max-w-[92%] flex flex-col gap-2">
                {#if message.text && message.text !== '...'}
                  <div class="px-4 py-2.5 text-[15px] leading-relaxed bg-surface-container-high text-on-surface rounded-[1.25rem] rounded-tl-md prose prose-sm">
                    {@html marked.parse(message.text)}
                  </div>
                {/if}
                {#if message.alternatives && message.alternatives.length > 0}
                  <RouteOptionsTabs
                    plans={[message.plan, ...message.alternatives]}
                    onSelect={(i) => {
                      const all = [message.plan, ...message.alternatives];
                      mapStore.clearRoutes();
                      applyRoutePlan(all[i]);
                    }}
                  />
                {:else}
                  <RouteStepsCard
                    plan={message.plan}
                    totalFare={calcTotalFare(message.plan.linesUsed)}
                  />
                {/if}
              </div>
            {:else}
              <div class="max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed bg-surface-container-high text-on-surface rounded-[1.25rem] rounded-tl-md prose prose-sm">
                {@html marked.parse(message.text)}
                {#if 'candidates' in message && message.candidates}
                  <div class="mt-3 flex flex-col gap-1.5">
                    {#each message.candidates as candidate, i}
                      <button
                        onclick={() => selectCandidate(i)}
                        disabled={!pendingClarification}
                        class="rounded-xl px-3.5 py-2.5 text-left text-[14px] transition-all
                               {pendingClarification
                                 ? 'border border-outline-variant bg-surface shadow-elevation-1 hover:border-primary/40 active:scale-[0.98]'
                                 : 'border border-transparent bg-surface-container-high text-on-surface/50'}"
                      >
                        {candidate.label}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        {#if isRouteLoading}
          <div class="flex items-center gap-2 px-1 text-[13px] text-primary/50">
            <span class="flex gap-1">
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/30"></span>
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/30 [animation-delay:150ms]"></span>
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/30 [animation-delay:300ms]"></span>
            </span>
            Calculando ruta...
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .messages-scroll::-webkit-scrollbar { display: none; }
  .messages-scroll { -ms-overflow-style: none; scrollbar-width: none; }

  /* Geometry transitions (not height — spring-animated in JS) */
  .sheet-card {
    transition:
      bottom        0.45s cubic-bezier(0.32, 0.72, 0, 1),
      width         0.45s cubic-bezier(0.32, 0.72, 0, 1),
      border-radius 0.45s cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow    0.3s ease;
  }
</style>
