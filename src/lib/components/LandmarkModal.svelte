<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { onDestroy } from 'svelte';
  import { landmarkStore } from '$lib/stores/landmarkStore';
  import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ICON } from '$lib/data/landmarks';
  import type { Landmark } from '$lib/data/landmarks';

  let lm = $state<Landmark | null>(null);
  let routeLoading = $state(false);

  const unsub = landmarkStore.subscribe(s => {
    if (s.activeLandmark) {
      lm = s.activeLandmark;
      routeLoading = false;
      dragY = 0;
    }
  });
  onDestroy(unsub);

  function handleRouteRequest() {
    if (routeLoading || !lm) return;
    routeLoading = true;
    setTimeout(() => landmarkStore.requestRoute(lm!.routeQueryName), 280);
  }

  function toDMS(deg: number, isLat: boolean): string {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60;
    const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'O');
    return `${d}°${m.toString().padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}" ${dir}`;
  }

  function formatCoords(coords: [number, number]): string {
    const [lng, lat] = coords;
    return `${toDMS(lat, true)},  ${toDMS(lng, false)}`;
  }

  let shareCopied = $state(false);

  // ── Swipe-to-dismiss ──
  let sheetEl = $state<HTMLDivElement | null>(null);
  let dragY = $state(0);        // translateY actual (solo hacia abajo)
  let dragStartY = 0;
  let dragging = false;
  let dragVel = 0;              // px/ms, positivo = hacia abajo
  let prevY = 0;
  let prevT = 0;

  function onDragStart(e: PointerEvent) {
    // Solo iniciar desde el handle (zona superior del sheet)
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    dragging = true;
    dragStartY = e.clientY;
    prevY = e.clientY;
    prevT = Date.now();
    dragVel = 0;
    dragY = 0;
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e: PointerEvent) {
    if (!dragging) return;
    const now = Date.now();
    const dt = now - prevT;
    if (dt > 0) dragVel = (e.clientY - prevY) / dt;
    prevY = e.clientY;
    prevT = now;
    const delta = e.clientY - dragStartY;
    dragY = Math.max(0, delta);   // solo hacia abajo, sin rubber band
  }

  function onDragEnd(_e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);

    const DISMISS_DIST = 120;   // px
    const DISMISS_VEL  = 0.5;   // px/ms
    if (dragY > DISMISS_DIST || dragVel > DISMISS_VEL) {
      dragY = 0;                // reset antes de cerrar para que la próxima apertura empiece limpia
      landmarkStore.close();
    } else {
      dragY = 0;                // spring back
    }
  }

  async function handleShare() {
    if (!lm) return;
    const [lng, lat] = lm.coordinates;
    const text = `${lm.name} — ${formatCoords(lm.coordinates)}`;
    const url = `https://maps.google.com/?q=${lat},${lng}`;
    if (navigator.share) {
      await navigator.share({ title: lm.name, text, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {});
      shareCopied = true;
      setTimeout(() => { shareCopied = false; }, 2000);
    }
  }
</script>

<!--
  Backdrop: desaparece al instante, no bloquea clicks al mapa durante la salida del sheet.
  Sheet: usa `lm` (latched) para mantener el contenido durante la transición de salida.
-->

{#if $landmarkStore.activeLandmark}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[34] bg-black/25"
    transition:fade={{ duration: 220 }}
    onclick={() => landmarkStore.close()}
    role="button"
    aria-label="Cerrar"
  ></div>
{/if}

{#if $landmarkStore.activeLandmark && lm}
  <div
    bind:this={sheetEl}
    class="fixed bottom-0 left-0 right-0 z-[35] mx-auto w-full"
    style="max-width: min(100vw, 32rem); box-shadow: 0 -4px 32px rgba(0,0,0,0.13);
           transform: translateY({dragY}px);
           transition: {dragging ? 'none' : 'transform 0.35s cubic-bezier(0.3,0,0,1)'};"
    transition:fly={{ y: 320, duration: 380, opacity: 1 }}
  >
    <div class="rounded-t-[1.75rem] bg-white overflow-hidden">

      <!-- Drag handle — zona de arrastre -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing select-none"
        style="touch-action: none;"
        onpointerdown={onDragStart}
      >
        <div class="h-[5px] w-9 rounded-full bg-black/[0.18]"></div>
      </div>

      <!-- ── Header fijo ── -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="px-5 pb-4" onpointerdown={onDragStart} style="touch-action: none;">

        <!-- Ícono + Nombre + Coords + Cerrar -->
        <div class="flex items-start gap-3">
          <!-- Círculo de categoría -->
          <div
            class="flex-shrink-0 flex items-center justify-center rounded-full w-12 h-12 shadow-sm"
            style="background:{CATEGORY_COLOR[lm.category]};"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
            >
              {@html lm.svg ?? CATEGORY_ICON[lm.category]}
            </svg>
          </div>

          <!-- Nombre + coordenadas -->
          <div class="flex-1 min-w-0 pt-0.5">
            <h2 class="text-[20px] font-bold text-on-surface leading-tight truncate">{lm.name}</h2>
            <p class="text-[11px] text-on-surface/40 font-medium mt-0.5 leading-none tracking-tight">
              {formatCoords(lm.coordinates)}
            </p>
          </div>

          <!-- Botón cerrar -->
          <button
            onclick={() => landmarkStore.close()}
            class="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] active:bg-black/[0.1] transition-colors mt-0.5"
            aria-label="Cerrar"
          >
            <svg class="w-4 h-4 text-on-surface/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Botones de acción -->
        <div class="flex gap-2 mt-4">
          <!-- Navegar — filled dark (como en la imagen) -->
          <button
            onclick={handleRouteRequest}
            disabled={routeLoading}
            class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-[13px] font-semibold text-on-primary transition-all active:scale-95 disabled:opacity-70"
          >
            {#if routeLoading}
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Buscando…
            {:else}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
              </svg>
              Cómo llego
            {/if}
          </button>

          <!-- Compartir — outlined -->
          <button
            onclick={handleShare}
            class="flex items-center gap-1.5 rounded-full border border-outline-variant px-4 py-2.5 text-[13px] font-semibold text-on-surface transition-all active:scale-95"
          >
            {#if shareCopied}
              <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
              </svg>
              Copiado
            {:else}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
              </svg>
              Compartir
            {/if}
          </button>

          <!-- Categoría — outlined con color -->
          <button
            class="flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[13px] font-semibold transition-all active:scale-95"
            style="border-color:{CATEGORY_COLOR[lm.category]}40; color:{CATEGORY_COLOR[lm.category]};"
          >
            {CATEGORY_LABEL[lm.category]}
          </button>
        </div>
      </div>

      <!-- ── Contenido scrollable ── -->
      <div class="overflow-y-auto pb-10 no-scrollbar" style="max-height: 52vh;">

        <!-- Sección: Acerca de -->
        <div class="mb-4">
          <p class="text-[16px] font-bold text-on-surface px-5 mb-3">Acerca de</p>

          <!-- Galería de imágenes (si existen) -->
          {#if lm.images && lm.images.length > 0}
            <div class="flex gap-2.5 overflow-x-auto px-5 pb-2 no-scrollbar" style="touch-action: pan-x;">
              {#each lm.images as src, i}
                <img
                  {src}
                  alt="{lm.name} {i + 1}"
                  class="flex-shrink-0 rounded-2xl object-cover"
                  style="height:116px; width:116px;"
                />
              {/each}
            </div>
          {/if}

          <!-- Descripción -->
          <p class="text-[14px] text-on-surface/60 leading-relaxed px-5 mt-3">{lm.description}</p>
        </div>

        <!-- Sección: Detalles -->
        <div class="px-5">
          <p class="text-[16px] font-bold text-on-surface mb-1">Detalles</p>

          <!-- Coordenadas -->
          <div class="flex items-center gap-3 py-3 border-t border-outline-variant/40">
            <div
              class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
              style="background:{CATEGORY_COLOR[lm.category]}15;"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                   style="stroke:{CATEGORY_COLOR[lm.category]};">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-wider text-on-surface/40 leading-none mb-0.5">Coordenadas</p>
              <p class="text-[12px] font-medium text-on-surface truncate">{formatCoords(lm.coordinates)}</p>
            </div>
          </div>

          <!-- Categoría -->
          <div class="flex items-center gap-3 py-3 border-t border-outline-variant/40">
            <div
              class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
              style="background:{CATEGORY_COLOR[lm.category]}15;"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
                style="stroke:{CATEGORY_COLOR[lm.category]};"
              >
                {@html lm.svg ?? CATEGORY_ICON[lm.category]}
              </svg>
            </div>
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-wider text-on-surface/40 leading-none mb-0.5">Categoría</p>
              <p class="text-[13px] font-medium text-on-surface">{CATEGORY_LABEL[lm.category]}</p>
            </div>
          </div>

          <!-- Actividades -->
          {#if lm.activities.length > 0}
            <div class="py-3 border-t border-outline-variant/40">
              <p class="text-[11px] font-semibold uppercase tracking-wider text-on-surface/40 mb-2.5">Actividades</p>
              <div class="flex flex-col gap-2">
                {#each lm.activities as activity}
                  <div class="flex items-start gap-2.5">
                    <div class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                         style="background:{CATEGORY_COLOR[lm.category]};"></div>
                    <span class="text-[13px] text-on-surface/70 leading-snug">{activity}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

      </div>
    </div>
  </div>
{/if}

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
