<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { marked } from 'marked';
  import { tick, onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { mapStore } from '$lib/stores/mapStore';
  import type { RouteId } from '$lib/data/transitRoutes';
  import RouteStepsCard from './RouteStepsCard.svelte';
  import RouteOptionsTabs from './RouteOptionsTabs.svelte';
  import { calcTotalFare } from '$lib/data/fareRules';

  marked.setOptions({ breaks: true });

  interface Props {
    externalUserLocation: [number, number] | null;
    externalLocationStatus: 'idle' | 'requesting' | 'granted' | 'denied';
    onLocationRequest: () => void;
  }

  let {
    externalUserLocation: userLocation,
    externalLocationStatus: locationStatus,
    onLocationRequest: requestLocation,
  } = $props<Props>();

  // ── DOM refs ──
  let cardEl = $state<HTMLDivElement | null>(null);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let isInputFocused = $state(false);

  // ── Height-based snap points (px) ──
  // Card is anchored at bottom:12px and grows UPWARD.
  // This way rounded bottom corners are always visible — true floating.
  const COMPACT_H = 140;
  let halfH = $state(370);
  let fullH = $state(620);
  const BOTTOM_GAP = 12; // always 12px from screen bottom

  function calcSnap() {
    if (!browser) return;
    halfH = Math.min(380, Math.round(window.innerHeight * 0.48));
    fullH = Math.round(window.innerHeight * 0.82);
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
    window.addEventListener('resize', calcSnap);
  });

  onDestroy(() => {
    if (springRAF !== null) cancelAnimationFrame(springRAF);
    if (browser) {
      window.removeEventListener('resize', calcSnap);
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
    field: 'origin' | 'destination';
    original: string;
    candidates: Array<{ label: string; coords: [number, number] }>;
    partialIntent: Record<string, any>;
  } | null>(null);

  const chat = new Chat({ api: '/api/chat' } as any);
  let routeMessages = $state<Array<{
    id: string;
    role: string;
    text: string;
    plan?: any;
    alternatives?: any[];
    candidates?: Array<{ label: string; coords: [number, number] }>;
  }>>([]);

  let input = $state('');
  const isStreaming = $derived(chat.status === 'streaming' || chat.status === 'submitted');
  let isRouteLoading = $state(false);

  const allMessages = $derived([
    ...routeMessages.map(m => ({ ...m, source: 'route' as const })),
    ...chat.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      text: m.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n\n') || m.content || '',
      source: 'chat' as const,
    })),
  ]);

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
            candidates: data.candidates, partialIntent: data.partialIntent,
          };
          routeMessages = [...routeMessages, {
            id: `assistant-${Date.now()}`, role: 'assistant',
            text: `Encontré varias opciones para "${data.original}" como ${data.field === 'destination' ? 'destino' : 'origen'}:`,
            candidates: data.candidates,
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
    const clarPayload = {
      field: pendingClarification.field, selectedCoords: candidate.coords,
      selectedLabel: candidate.label, partialIntent: pendingClarification.partialIntent,
    };
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
    for (const routeId of plan.linesUsed) mapStore.drawRoute(routeId as RouteId);
    mapStore.setJourney(
      { name: plan.origin.name, coordinates: plan.origin.coords },
      { name: plan.destination.name, coordinates: plan.destination.coords },
      plan.boardingStations, plan.alightingStations,
    );
    for (const s of plan.boardingStations) mapStore.addStationHighlight(s, 'board');
    for (const s of plan.alightingStations) mapStore.addStationHighlight(s, 'alight');
    for (const step of plan.steps) {
      if (step.type === 'walk' && step.walkGeometry) mapStore.addWalkSegment(step.walkGeometry);
    }
  }

  const suggestions = [
    { text: 'Cómo llego al Estadio BBVA?', label: 'Estadio BBVA' },
    { text: 'Rutas a Pabellón M', label: 'Pabellón M' },
    { text: 'De Uni a Fundidora', label: 'Fundidora' },
    { text: 'Cómo llego a Macroplaza?', label: 'Macroplaza' },
  ];

  function submitSuggestion(text: string) {
    input = text;
    handleSubmit(new Event('submit') as any);
  }
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
  class="sheet-card fixed left-0 right-0 z-20 mx-auto flex flex-col overflow-hidden bg-white/97 backdrop-blur-2xl"
  style:bottom={targetMode === 'full' ? '0' : BOTTOM_GAP + 'px'}
  style:width={targetMode === 'full' ? '100%' : 'min(calc(100vw - 24px), 32rem)'}
  style:border-radius={targetMode === 'full' ? '1.25rem 1.25rem 0 0' : '1.75rem'}
  style:box-shadow={targetMode !== 'full'
    ? '0 -2px 24px rgba(0,0,0,0.09), 0 0 0 0.5px rgba(0,0,0,0.04)'
    : '0 -1px 4px rgba(0,0,0,0.06)'}
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
      <div class="h-[5px] w-9 rounded-full bg-black/[0.18]"></div>
    </div>

    <!-- Brand + Status row -->
    <div class="flex items-center justify-between px-5 pb-2.5 pt-0.5">
      <div class="flex items-center gap-2.5 min-w-0">
        <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <svg class="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
        </div>
        <div class="min-w-0">
          <p class="text-[15px] font-bold leading-tight text-primary">Neoleo Ruta</p>
          {#if allMessages.length > 0 && sheetMode === 'compact'}
            <p class="max-w-[190px] truncate text-[12px] leading-tight text-primary/50">
              {isRouteLoading || isStreaming ? 'Calculando ruta...' : lastAssistantPreview}
            </p>
          {:else if sheetMode === 'compact'}
            <p class="text-[12px] leading-tight text-primary/40">Monterrey · Transporte público</p>
          {/if}
        </div>
      </div>

      {#if allMessages.length > 0 && sheetMode === 'compact'}
        <button
          onclick={() => springTo(halfH)}
          class="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-secondary/30 active:bg-secondary/50 transition-colors"
        >
          <span class="text-[12px] font-semibold text-primary/70">{allMessages.length} msg</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- ── Search Bar ── -->
  <div class="flex-shrink-0 px-4 pb-3">
    <form onsubmit={handleSubmit}>
      <div
        class="relative flex items-center rounded-xl transition-all duration-200"
        style="background: rgba(40,90,113,0.07); {isInputFocused ? 'outline: 2px solid rgba(40,90,113,0.2); background: white;' : ''}"
      >
        <svg class="pointer-events-none absolute left-3.5 h-[18px] w-[18px] text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
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
          placeholder="Buscar ruta o destino"
          class="w-full bg-transparent py-[11px] pl-10 pr-12 text-[16px] text-[#1c1b1d] placeholder-primary/30 focus:outline-none"
        />
        {#if input.trim()}
          <button
            type="submit"
            disabled={isStreaming || isRouteLoading}
            class="absolute right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white transition-all duration-150 active:scale-90 disabled:opacity-40"
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
           transition-opacity duration-200
           {sheetMode === 'compact' ? 'opacity-0 pointer-events-none' : 'opacity-100'}"
    style="touch-action: pan-y;"
  >
    {#if allMessages.length === 0}
      <div class="pt-2 px-1">
        <p class="mb-3 px-1 text-[12px] font-semibold uppercase tracking-wider text-primary/40">Sugerencias</p>
        <div class="flex flex-col">
          {#each suggestions as s, i}
            <button
              onclick={() => submitSuggestion(s.text)}
              class="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-black/[0.04]"
            >
              <div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/[0.07]">
                <svg class="h-[17px] w-[17px] text-primary/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </div>
              <span class="flex-1 text-[15px] text-[#1c1b1d]">{s.label}</span>
              <svg class="h-4 w-4 flex-shrink-0 text-[#C7C7CC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
            </button>
            {#if i < suggestions.length - 1}
              <div class="ml-[52px] h-px bg-primary/[0.07]"></div>
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-4 pt-2">
        {#each allMessages as message (message.id)}
          <div class="flex flex-col {message.role === 'user' ? 'items-end' : 'items-start'}">
            {#if message.role === 'user'}
              <div class="max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed bg-primary text-white rounded-[1.25rem] rounded-tr-md shadow-sm">
                {message.text}
              </div>
            {:else if 'plan' in message && message.plan}
              <!-- Route response: short greeting + visual step card -->
              <div class="w-full max-w-[92%] flex flex-col gap-2">
                {#if message.text && message.text !== '...'}
                  <div class="px-4 py-2.5 text-[15px] leading-relaxed bg-[#F2F2F7] text-[#1c1b1d] rounded-[1.25rem] rounded-tl-md prose prose-sm">
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
              <div class="max-w-[85%] px-4 py-2.5 text-[15px] leading-relaxed bg-[#F2F2F7] text-[#1c1b1d] rounded-[1.25rem] rounded-tl-md prose prose-sm">
                {@html marked.parse(message.text)}
                {#if 'candidates' in message && message.candidates}
                  <div class="mt-3 flex flex-col gap-1.5">
                    {#each message.candidates as candidate, i}
                      <button
                        onclick={() => selectCandidate(i)}
                        disabled={!pendingClarification}
                        class="rounded-xl px-3.5 py-2.5 text-left text-[14px] transition-all
                               {pendingClarification
                                 ? 'border border-[#E5E5EA] bg-white shadow-sm hover:border-primary/40 active:scale-[0.98]'
                                 : 'border border-transparent bg-[#F2F2F7] text-[#8E8E93]'}"
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
