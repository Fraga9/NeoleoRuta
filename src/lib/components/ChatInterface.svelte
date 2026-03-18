<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { marked } from 'marked';
  import { tick } from 'svelte';
  import { mapStore } from '$lib/stores/mapStore';
  import type { RouteId } from '$lib/data/transitRoutes';

  marked.setOptions({ breaks: true });

  interface Props {
    externalUserLocation: [number, number] | null;
    externalLocationStatus: 'idle' | 'requesting' | 'granted' | 'denied';
    onLocationRequest: () => void;
  }

  let { externalUserLocation: userLocation, externalLocationStatus: locationStatus, onLocationRequest: requestLocation } = $props<Props>();

  // ── Collapse state ──
  let isCollapsed = $state(false);

  function toggleCollapse() {
    isCollapsed = !isCollapsed;
  }

  // Auto-expand when new messages arrive
  $effect(() => {
    if (chat.messages.length > 0 && isStreaming) {
      isCollapsed = false;
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

  // Chat class for general (non-route) conversations
  const chat = new Chat({ api: '/api/chat' } as any);

  // Manual messages for route queries (bypasses Chat class)
  let routeMessages = $state<Array<{ id: string; role: string; text: string; candidates?: Array<{ label: string; coords: [number, number] }> }>>([]);

  let input = $state('');
  let messagesEl = $state<HTMLDivElement | null>(null);

  const isStreaming = $derived(chat.status === 'streaming' || chat.status === 'submitted');
  let isRouteLoading = $state(false);

  // Combined messages for display
  const allMessages = $derived([
    ...routeMessages.map(m => ({ ...m, source: 'route' as const })),
    ...chat.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      text: m.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n\n') || m.content || '',
      source: 'chat' as const,
    })),
  ]);

  async function scrollToBottom() {
    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  $effect(() => {
    allMessages;
    scrollToBottom();
  });

  // ── SSE stream consumer (shared by handleSubmit and selectCandidate) ──
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
          routeMessages = [...routeMessages, { id: assistantMsgId, role: 'assistant', text: '...' }];
          gotRoute = true;
        } else if (eventType === 'nlg-chunk' && assistantMsgId) {
          nlgText += data.text;
          routeMessages = routeMessages.map(m =>
            m.id === assistantMsgId ? { ...m, text: nlgText } : m
          );
        } else if (eventType === 'clarification') {
          isRouteLoading = false;
          pendingClarification = {
            field: data.field,
            original: data.original,
            candidates: data.candidates,
            partialIntent: data.partialIntent,
          };
          const fieldLabel = data.field === 'destination' ? 'destino' : 'origen';
          const header = `Encontré varias opciones para "${data.original}" como ${fieldLabel}:`;
          const id = `assistant-${Date.now()}`;
          routeMessages = [...routeMessages, {
            id,
            role: 'assistant',
            text: header,
            candidates: data.candidates,
          }];
          gotRoute = true;
        } else if (eventType === 'done') {
          if (!gotPlan && !pendingClarification && data?.nlgText) {
            const id = `assistant-${Date.now()}`;
            routeMessages = [...routeMessages, { id, role: 'assistant', text: data.nlgText }];
          } else if (!gotPlan && !pendingClarification && data?.error) {
            const id = `assistant-${Date.now()}`;
            routeMessages = [...routeMessages, { id, role: 'assistant', text: data.error }];
          }
        }
      }
    }
    return gotRoute;
  }

  // ── Candidate selection (button click or number input) ──
  async function selectCandidate(index: number) {
    if (!pendingClarification) return;
    const candidate = pendingClarification.candidates[index];
    if (!candidate) return;

    const userMsgId = `user-${Date.now()}`;
    routeMessages = [...routeMessages, { id: userMsgId, role: 'user', text: candidate.label }];

    const clarPayload = {
      field: pendingClarification.field,
      selectedCoords: candidate.coords,
      selectedLabel: candidate.label,
      partialIntent: pendingClarification.partialIntent,
    };
    pendingClarification = null;

    // Send clarification request
    isRouteLoading = true;
    mapStore.clearRoutes();
    try {
      const body: any = { message: '', clarification: clarPayload };
      if (userLocation) body.userLocation = userLocation;

      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok && response.body) {
        await consumeSSE(response.body);
      }
    } catch (e) {
      console.error('[CLIENT] Clarification fetch error:', e);
    }
    isRouteLoading = false;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming || isRouteLoading) return;

    const userMessage = input.trim();
    input = '';

    // Check if user is responding to disambiguation with a number
    if (pendingClarification) {
      const numMatch = userMessage.match(/^(?:la\s+)?(\d+)$/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1]) - 1;
        if (idx >= 0 && idx < pendingClarification.candidates.length) {
          await selectCandidate(idx);
          return;
        }
      }
      // Not a valid number — treat as new query, clear disambiguation
      pendingClarification = null;
    }

    mapStore.clearRoutes();
    currentRoutePlan = null;

    // Add user message immediately
    const userMsgId = `user-${Date.now()}`;
    routeMessages = [...routeMessages, { id: userMsgId, role: 'user', text: userMessage }];

    // Try route planning via SSE (2-phase: plan first, then NLG streaming)
    isRouteLoading = true;
    try {
      const body: any = { message: userMessage };
      if (userLocation) body.userLocation = userLocation;

      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok && response.body) {
        const gotRoute = await consumeSSE(response.body);
        if (gotRoute) {
          isRouteLoading = false;
          return;
        }
      }
    } catch (e) {
      console.error('[CLIENT] Route plan fetch error:', e);
    }

    isRouteLoading = false;

    // Step 2: Not a route query — use Chat class for general chat
    // Remove the user message from routeMessages (Chat class will manage it)
    routeMessages = routeMessages.filter(m => m.id !== userMsgId);
    chat.sendMessage({ text: userMessage });
  }

  function applyRoutePlan(plan: any) {
    console.log('[CLIENT] ✅ Applying route plan:', plan);

    for (const routeId of plan.linesUsed) {
      mapStore.drawRoute(routeId as RouteId);
    }

    mapStore.setJourney(
      { name: plan.origin.name, coordinates: plan.origin.coords },
      { name: plan.destination.name, coordinates: plan.destination.coords },
      plan.boardingStations,
      plan.alightingStations,
    );

    for (const station of plan.boardingStations) {
      mapStore.addStationHighlight(station, 'board');
    }
    for (const station of plan.alightingStations) {
      mapStore.addStationHighlight(station, 'alight');
    }

    // Push real street walk geometries from OSRM (if available)
    for (const step of plan.steps) {
      if (step.type === 'walk' && step.walkGeometry) {
        mapStore.addWalkSegment(step.walkGeometry);
      }
    }
  }

  function getMessageText(message: any): string {
    if (message.parts) {
      return message.parts
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n\n');
    }
    return message.content ?? '';
  }
</script>

<div class="absolute bottom-4 left-4 right-4 z-10 mx-auto flex max-w-lg flex-col gap-2 transition-all duration-300">
  {#if isCollapsed && allMessages.length > 0}
    <!-- Collapsed State: Compact Bar -->
    <button
      onclick={toggleCollapse}
      class="w-full h-14 rounded-full bg-white/95 backdrop-blur-md shadow-expressive
             flex items-center justify-between px-6
             hover:bg-white hover:shadow-lg transition-all cursor-pointer
             border-2 border-primary/20 group"
    >
      <span class="font-semibold text-primary flex items-center gap-3">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
        </svg>
        <span>Neoleo Ruta</span>
        <span class="text-xs bg-primary text-white rounded-full min-w-6 h-6 px-2 flex items-center justify-center font-bold">
          {allMessages.length}
        </span>
      </span>
      <span class="text-sm text-gray-600 group-hover:text-primary transition-colors flex items-center gap-2">
        Click para expandir
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>
        </svg>
      </span>
    </button>
  {:else}
    <!-- Expanded State: Full Chat Interface -->
    <div class="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <!-- Chat Messages Container -->
      {#if allMessages.length > 0}
        <div class="relative rounded-3xl bg-white/90 backdrop-blur-md shadow-expressive">
          <!-- Collapse Button -->
          <button
            onclick={toggleCollapse}
            class="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-200/80 hover:bg-gray-300
                   flex items-center justify-center transition-all z-20 group"
            title="Minimizar chat"
          >
            <svg class="w-4 h-4 text-gray-600 group-hover:text-gray-800 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>

          <!-- Messages -->
          <div
            bind:this={messagesEl}
            class="max-h-[50vh] overflow-y-auto p-4 pr-12 scrollbar-hide"
          >
            <div class="flex flex-col gap-3">
              {#each allMessages as message (message.id)}
                <div class="flex flex-col {message.role === 'user' ? 'items-end' : 'items-start'}">
                  <span class="text-xs text-gray-400 mb-1 ml-2">
                    {message.role === 'user' ? 'Tú' : 'Neoleo Ruta Inteligente'}
                  </span>
                  <div
                    class="max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed
                      {message.role === 'user'
                        ? 'bg-primary text-white rounded-tr-sm'
                        : 'bg-gray-100 text-gray-800 rounded-tl-sm prose prose-sm max-w-none'}"
                  >
                    {#if message.role === 'user'}
                      {message.text}
                    {:else}
                      {@html marked.parse(message.text)}
                      {#if message.candidates}
                        <div class="flex flex-col gap-1.5 mt-2">
                          {#each message.candidates as candidate, i}
                            <button
                              onclick={() => selectCandidate(i)}
                              disabled={!pendingClarification}
                              class="text-left px-3 py-2 rounded-lg border transition-all text-sm
                                     flex items-center gap-2
                                     {pendingClarification
                                       ? 'bg-white border-gray-200 hover:border-primary hover:bg-primary/5 cursor-pointer'
                                       : 'bg-gray-50 border-gray-100 text-gray-400 cursor-default'}"
                            >
                              <span class="font-bold min-w-[1.5rem] {pendingClarification ? 'text-primary' : 'text-gray-300'}">{i + 1}.</span>
                              <span>{candidate.label}</span>
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                </div>
              {/each}
              {#if isRouteLoading}
                <div class="flex flex-col items-start">
                  <span class="text-xs text-gray-400 mb-1 ml-2">Neoleo Ruta Inteligente</span>
                  <div class="bg-gray-100 text-gray-500 rounded-2xl rounded-tl-sm px-4 py-2 text-sm flex items-center gap-2">
                    <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]"></span>
                    <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]"></span>
                    <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]"></span>
                    <span class="ml-1">Calculando ruta...</span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Input Area -->
      <div class="rounded-3xl bg-white/90 p-6 shadow-expressive backdrop-blur-md">
        {#if allMessages.length === 0}
          <h1 class="mb-2 text-xl font-bold text-primary">Neoleo Ruta Inteligente</h1>
          <p class="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
            <span>¿A dónde quieres ir hoy en Monterrey?</span>
            {#if locationStatus === 'granted'}
              <span class="inline-flex items-center gap-1.5 text-green-600 font-medium">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                Ubicación activa
              </span>
            {:else if locationStatus === 'requesting'}
              <span class="inline-flex items-center gap-1.5 text-yellow-600 font-medium">
                <svg class="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                Solicitando ubicación...
              </span>
            {:else if locationStatus === 'denied'}
              <button class="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 underline font-medium" onclick={requestLocation}>
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                Activar ubicación
              </button>
            {/if}
          </p>
        {/if}

        <form class="mt-4 flex gap-2" onsubmit={handleSubmit}>
          <input
            type="text"
            bind:value={input}
            disabled={isStreaming}
            placeholder={chat.messages.length === 0 ? 'Ej: ¿Cómo llego al Estadio BBVA?' : 'Escribe un mensaje...'}
            class="flex-1 rounded-full border border-gray-200 bg-white px-8 py-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            class="rounded-full bg-secondary px-8 py-3 font-semibold text-primary shadow-sm transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
          >
            {#if isStreaming}
              <span class="flex items-center gap-1">
                <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]"></span>
                <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]"></span>
                <span class="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]"></span>
              </span>
            {:else}
              Ir
            {/if}
          </button>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes slide-in-from-bottom-4 {
    from {
      transform: translateY(1rem);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .animate-in {
    animation: fade-in 0.3s ease-out, slide-in-from-bottom-4 0.3s ease-out;
  }
</style>
