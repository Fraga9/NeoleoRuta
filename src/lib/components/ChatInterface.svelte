<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { marked } from 'marked';
  import { tick } from 'svelte';
  import { mapStore } from '$lib/stores/mapStore';
  import type { RouteId } from '$lib/data/transitRoutes';

  import { resolveCoordinates } from '$lib/data/knownPlaces';

  marked.setOptions({ breaks: true });

  const chat = new Chat({ api: '/api/chat', maxSteps: 5 } as any);

  let input = $state('');
  let messagesEl = $state<HTMLDivElement | null>(null);

  const isStreaming = $derived(chat.status === 'streaming' || chat.status === 'submitted');

  const processedToolCallIds = new Set<string>();

  async function scrollToBottom() {
    await tick();
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  $effect(() => {
    const currentMessages = chat.messages;
    scrollToBottom();

    for (const msg of currentMessages) {
      if (msg.role !== 'assistant' || !msg.parts) continue;
      for (const part of msg.parts) {
        if (part.type?.startsWith('tool-')) {
          const p = part as any;
          const toolCallId = p.toolCallId || p.toolInvocation?.toolCallId;
          const state = p.state || p.toolInvocation?.state;
          const args = p.args || p.toolInvocation?.args || p.input;

          if (state !== 'result' && state !== 'output-available') continue;
          if (!toolCallId || processedToolCallIds.has(toolCallId)) continue;

          processedToolCallIds.add(toolCallId);

          // Handle unified draw_route with optional journey context
          if (args?.routeId) {
            mapStore.drawRoute(args.routeId as RouteId);

            // Extract journey context from optional args
            if (args.origin || args.destination) {
              const originCoords = args.origin ? resolveCoordinates(args.origin) : null;
              const destCoords = args.destination ? resolveCoordinates(args.destination) : null;
              mapStore.setJourney(
                originCoords ? { name: args.origin, coordinates: originCoords } : null,
                destCoords ? { name: args.destination, coordinates: destCoords } : null,
                [], [],
              );
            }
            if (args.boardStation) {
              mapStore.addStationHighlight(args.boardStation, 'board');
            }
            if (args.alightStation) {
              mapStore.addStationHighlight(args.alightStation, 'alight');
            }
          }
        }
      }
    }
  });

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    chat.sendMessage({ text: input });
    input = '';
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

<div class="absolute bottom-4 left-4 right-4 z-10 mx-auto flex max-w-lg flex-col gap-2">
  <!-- Chat Messages Container -->
  {#if chat.messages.length > 0}
    <div
      bind:this={messagesEl}
      class="max-h-[50vh] overflow-y-auto rounded-3xl bg-white/90 p-4 shadow-expressive backdrop-blur-md scrollbar-hide"
    >
      <div class="flex flex-col gap-3">
        {#each chat.messages as message (message.id)}
          <div class="flex flex-col {message.role === 'user' ? 'items-end' : 'items-start'}">
            <span class="text-xs text-gray-400 mb-1 ml-2">
              {message.role === 'user' ? 'Tú' : 'RegioRuta Inteligente'}
            </span>
            <div
              class="max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed
                {message.role === 'user'
                  ? 'bg-primary text-white rounded-tr-sm'
                  : 'bg-gray-100 text-gray-800 rounded-tl-sm prose prose-sm max-w-none'}"
            >
              {#if message.role === 'user'}
                {getMessageText(message)}
              {:else}
                {@html marked.parse(getMessageText(message))}
                {#if isStreaming && message === chat.messages[chat.messages.length - 1]}
                  <span class="inline-block w-1.5 h-3.5 bg-gray-500 ml-0.5 animate-pulse rounded-sm align-middle"></span>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Input Area -->
  <div class="rounded-3xl bg-white/90 p-4 shadow-expressive backdrop-blur-md">
    {#if chat.messages.length === 0}
      <h1 class="mb-2 text-xl font-bold text-primary">RegioRuta Inteligente</h1>
      <p class="text-sm text-gray-600">¿A dónde quieres ir hoy en Monterrey?</p>
    {/if}

    <form class="mt-4 flex gap-2" onsubmit={handleSubmit}>
      <input
        type="text"
        bind:value={input}
        disabled={isStreaming}
        placeholder={chat.messages.length === 0 ? 'Ej: Quiero ir al Hospital Santa Lucía...' : 'Escribe un mensaje...'}
        class="flex-1 rounded-full border border-gray-200 bg-white px-6 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!input.trim() || isStreaming}
        class="rounded-full bg-secondary px-6 py-2 font-semibold text-primary shadow-sm transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
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
