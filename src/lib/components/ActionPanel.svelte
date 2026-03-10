<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Item {
    id: string;
    title: string;
    description: string;
    iconPath: string;
    color: string;
    badge?: string;
    extraInfo?: string;
    action?: () => void;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onBack?: () => void;
    title: string;
    subtitle: string;
    items: Item[];
    footerText?: string;
  }

  let { isOpen, onClose, onBack, title, subtitle, items, footerText } = $props<Props>();

  // ── Gestos de Arrastre ──
  let translateY = $state(0);
  let startY = 0;
  let isDragging = $state(false);

  function onTouchStart(e: TouchEvent) {
    startY = e.touches[0].clientY;
    isDragging = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    const delta = e.touches[0].clientY - startY;
    if (delta > 0) translateY = delta;
  }

  function onTouchEnd() {
    isDragging = false;
    if (translateY > 150) onClose();
    translateY = 0;
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div 
    transition:fade={{ duration: 200 }}
    onclick={onClose}
    class="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px]"
  ></div>

  <!-- Bottom Sheet -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    transition:fly={{ y: 800, duration: 450, easing: cubicOut }}
    class="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-[3rem] bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-2xl transition-transform"
    style="height: 85vh; transform: translateY({translateY}px); transition: {isDragging ? 'none' : 'transform 0.3s cubic-out'};"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <!-- Handle -->
    <div class="flex w-full cursor-grab justify-center p-6 active:cursor-grabbing">
      <div class="h-1.5 w-16 rounded-full bg-gray-300/60"></div>
    </div>

    <!-- Header con Navegación -->
    <div class="px-8 pb-4 pt-0">
      <div class="flex items-center gap-4">
        {#if onBack}
          <button 
            onclick={onBack}
            class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/5 text-primary hover:bg-primary/10 transition-all active:scale-90"
          >
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        {/if}
        <div class="flex-1">
          <h2 class="text-2xl font-bold text-primary">{title}</h2>
          <p class="text-sm font-semibold text-gray-400">{subtitle}</p>
        </div>
        <button 
          onclick={onClose}
          class="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all active:scale-90"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Lista -->
    <div class="flex-1 overflow-y-auto px-6 pb-12">
      {#if items.length > 0}
        <div class="flex flex-col gap-3">
          {#each items as item}
            <button 
              onclick={() => item.action?.()}
              class="group flex w-full items-center gap-4 rounded-[2rem] border border-black/5 bg-white p-4 shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
            >
              <div 
                class="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-inner transition-transform group-hover:scale-110"
                style="background-color: {item.color};"
              >
                <svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconPath} />
                </svg>
              </div>
              
              <div class="flex flex-1 flex-col text-left">
                <div class="flex items-center justify-between">
                  <span class="font-bold text-primary">{item.title}</span>
                  {#if item.extraInfo}
                    <span class="text-[10px] font-bold text-primary/40 uppercase tracking-widest">{item.extraInfo}</span>
                  {/if}
                </div>
                <span class="text-xs font-semibold text-gray-500">{item.description}</span>
                
                {#if item.badge}
                  <div class="mt-2">
                    <span class="rounded-full bg-secondary/20 px-2 py-0.5 text-[10px] font-bold text-primary/70 uppercase">
                      {item.badge}
                    </span>
                  </div>
                {/if}
              </div>

              <div class="text-gray-200 group-hover:text-primary transition-colors">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                </svg>
              </div>
              </button>
              {/each}
              </div>      {:else}
        <div class="mt-12 flex flex-col items-center justify-center text-center px-10 text-gray-400">
          <p>No hay información disponible por el momento.</p>
        </div>
      {/if}

      {#if footerText}
        <div class="mt-10 rounded-3xl bg-primary/[0.03] p-6 border border-primary/5">
          <p class="text-[11px] font-bold text-primary/40 italic uppercase tracking-wider text-center">
            {footerText}
          </p>
        </div>
      {/if}
    </div>
  </div>
{/if}
