<script lang="ts">
  import { fly } from 'svelte/transition';
  import { onDestroy } from 'svelte';
  import { landmarkStore } from '$lib/stores/landmarkStore';
  import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ICON } from '$lib/data/landmarks';
  import type { Landmark } from '$lib/data/landmarks';

  // "Latched" landmark: only updates when a landmark is OPENED, never on close.
  // This keeps the content valid during the fly-out transition (when store is already null).
  let lm = $state<Landmark | null>(null);
  const unsub = landmarkStore.subscribe(s => {
    if (s.activeLandmark) lm = s.activeLandmark;
  });
  onDestroy(unsub);
</script>

<!--
  Backdrop: NO transition → desaparece al instante, NO bloquea clicks al mapa durante la animación de salida del sheet.
  Sheet: fly-out → usa `lm` (latched) no `$landmarkStore.activeLandmark`, seguro durante la transición.
-->

{#if $landmarkStore.activeLandmark}
  <div
    class="fixed inset-0 z-[34] bg-black/25"
    onclick={() => landmarkStore.close()}
    role="button"
    tabindex="-1"
    aria-label="Cerrar"
  ></div>
{/if}

{#if $landmarkStore.activeLandmark && lm}
  <div
    class="fixed bottom-0 left-0 right-0 z-[35] mx-auto w-full"
    style="max-width: min(100vw, 32rem); box-shadow: 0 -4px 32px rgba(0,0,0,0.12);"
    transition:fly={{ y: 320, duration: 380, opacity: 1 }}
  >
    <div class="rounded-t-[1.75rem] bg-white overflow-hidden">
      <div class="flex justify-center pt-3 pb-1">
        <div class="h-[5px] w-9 rounded-full bg-black/[0.18]"></div>
      </div>

      <div class="overflow-y-auto px-5 pb-8" style="max-height: 72vh;">

        <!-- Header: badge + close -->
        <div class="flex items-center justify-between mb-3 pt-1">
          <span
            class="text-[11px] font-bold px-3 py-1 rounded-full text-white uppercase tracking-wide"
            style="background: {CATEGORY_COLOR[lm.category]}"
          >
            {CATEGORY_LABEL[lm.category]}
          </span>
          <button
            onclick={() => landmarkStore.close()}
            class="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.1] transition-colors"
            aria-label="Cerrar"
          >
            <svg class="w-4 h-4 text-primary/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Icon + name -->
        <div class="flex items-center gap-3 mb-3">
          <div
            class="flex-shrink-0 flex items-center justify-center rounded-xl"
            style="width:52px;height:52px;background:{CATEGORY_COLOR[lm.category]}18;"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              style="stroke:{CATEGORY_COLOR[lm.category]}"
            >
              {@html CATEGORY_ICON[lm.category]}
            </svg>
          </div>
          <h2 class="text-[21px] font-bold text-primary leading-tight">{lm.name}</h2>
        </div>

        <!-- Description -->
        <p class="text-[14px] text-[#4B5563] leading-relaxed mb-5">{lm.description}</p>

        <!-- Activities -->
        <div class="mb-6">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-primary/50 mb-2.5">Qué hacer</p>
          <div class="flex flex-col gap-2">
            {#each lm.activities as activity}
              <div class="flex items-start gap-2.5">
                <div class="mt-[5px] w-1.5 h-1.5 rounded-full flex-shrink-0"
                     style="background:{CATEGORY_COLOR[lm.category]}"></div>
                <span class="text-[14px] text-[#374151] leading-snug">{activity}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- CTA -->
        <button
          onclick={() => landmarkStore.requestRoute(lm!.routeQueryName)}
          class="w-full flex items-center justify-center gap-2.5 rounded-[1.25rem] bg-primary py-3.5
                 text-white font-semibold text-[15px] active:scale-[0.97] transition-transform shadow-sm"
        >
          <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
          ¿Cómo llego aquí?
        </button>

      </div>
    </div>
  </div>
{/if}
