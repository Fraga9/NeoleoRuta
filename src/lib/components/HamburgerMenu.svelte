<script lang="ts">
  import { scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    onAction?: (id: string) => void;
  }

  let { onAction } = $props<Props>();
  let isOpen = $state(false);

  const menuItems = [
    { 
      id: 'nearby', 
      label: 'Rutas cercanas', 
      description: 'Detección por GPS',
      iconPath: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z' 
    },
    { 
      id: 'all', 
      label: 'Todas las rutas', 
      description: 'Catálogo oficial',
      iconPath: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1M21 16V9a1 1 0 00-1-1h-6' 
    },
    { 
      id: 'payment', 
      label: 'Métodos de pago', 
      description: 'Urbani & Me Muevo',
      iconPath: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' 
    },
    { 
      id: 'recharge', 
      label: 'Puntos de recarga', 
      description: 'OXXO & Estaciones',
      iconPath: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' 
    },
    { 
      id: 'fares', 
      label: 'Tarifas', 
      description: 'Precios vigentes',
      iconPath: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' 
    }
  ];

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function handleAction(id: string) {
    console.log(`Menu action: ${id}`);
    isOpen = false;
    onAction?.(id);
  }

  // Close when clicking outside
  function handleOutsideClick(node: HTMLElement) {
    const handleClick = (event: MouseEvent) => {
      if (node && !node.contains(event.target as Node) && !event.defaultPrevented) {
        isOpen = false;
      }
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy() {
        document.removeEventListener('click', handleClick, true);
      }
    };
  }
</script>

<div class="absolute top-6 left-6 z-50 flex flex-col gap-3" use:handleOutsideClick>
  <!-- Main Toggle Button -->
  <button
    onclick={toggleMenu}
    class="group flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-expressive ring-1 ring-black/5 backdrop-blur-xl transition-all hover:bg-white active:scale-95"
    aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}
  >
    <div class="relative flex h-6 w-6 items-center justify-center">
      <span class="absolute h-0.5 w-6 rounded-full bg-primary/80 transition-all duration-300 {isOpen ? 'rotate-45' : '-translate-y-2'}"></span>
      <span class="absolute h-0.5 w-6 rounded-full bg-primary/80 transition-all duration-300 {isOpen ? 'opacity-0' : ''}"></span>
      <span class="absolute h-0.5 w-6 rounded-full bg-primary/80 transition-all duration-300 {isOpen ? '-rotate-45' : 'translate-y-2'}"></span>
    </div>
  </button>

  <!-- Floating Dropdown -->
  {#if isOpen}
    <div
      transition:scale={{ duration: 250, easing: cubicOut, start: 0.95, opacity: 0 }}
      class="mt-1 w-72 origin-top-left overflow-hidden rounded-[2.5rem] bg-white/95 p-3 shadow-expressive ring-1 ring-black/5 backdrop-blur-2xl"
    >
      <div class="mb-4 px-6 pt-5">
        <h3 class="text-[11px] font-bold tracking-[0.1em] text-primary/40 uppercase">Menú RegioRuta</h3>
      </div>

      <nav class="flex flex-col gap-1">
        {#each menuItems as item}
          <button
            onclick={() => handleAction(item.id)}
            class="group flex w-full items-center gap-4 rounded-[2rem] p-3 text-left transition-all hover:bg-primary/5 active:scale-[0.98]"
          >
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5 text-primary/70 transition-colors group-hover:bg-primary group-hover:text-white">
              <svg 
                class="h-5 w-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24" 
                stroke-width="1.5"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d={item.iconPath} />
              </svg>
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-bold text-primary/90">{item.label}</span>
              <span class="text-[10px] text-gray-400 font-semibold tracking-wide">{item.description}</span>
            </div>
          </button>
        {/each}
      </nav>

      <div class="mt-4 border-t border-black/5 p-2">
        <a 
          href="https://urbani.com.mx/" 
          target="_blank"
          class="flex items-center justify-between rounded-xl px-4 py-3 text-xs font-bold text-primary/60 hover:bg-secondary/20 hover:text-primary transition-all"
        >
          <span>App Urbani</span>
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
          </svg>
        </a>
      </div>
    </div>
  {/if}
</div>
