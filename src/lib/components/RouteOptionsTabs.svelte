<script lang="ts">
  import { calcTotalFare, formatFare } from '$lib/data/fareRules';
  import RouteStepsCard from './RouteStepsCard.svelte';

  interface Props { plans: any[]; onSelect: (i: number) => void; }
  let { plans, onSelect } = $props<Props>();
  let selectedIdx = $state(0);

  function countTransfers(plan: any) {
    return plan.steps.filter((s: any) => s.type === 'transfer').length;
  }

  function getLabel(index: number): string {
    if (index === 0) return 'Más rápida';
    const firstNoTransfer = plans.findIndex((p, i) => i > 0 && countTransfers(p) === 0);
    if (firstNoTransfer === index) return 'Sin transbordo';
    return `Opción ${index + 1}`;
  }

  function selectTab(i: number) { selectedIdx = i; onSelect(i); }
</script>

<div class="flex gap-2 overflow-x-auto pb-1 no-scrollbar" style="touch-action: pan-x;">
  {#each plans as plan, i}
    <button onclick={() => selectTab(i)}
      class="flex-shrink-0 flex flex-col items-center gap-0.5 px-4 py-2 rounded-full
             transition-all duration-200 active:scale-95
             {i === selectedIdx ? 'bg-primary text-white shadow-md' : 'bg-primary/[0.07] text-primary/70'}">
      <span class="text-[12px] font-semibold whitespace-nowrap">{getLabel(i)}</span>
      <span class="text-[11px] opacity-80">{plan.totalDuration} min · {formatFare(calcTotalFare(plan.linesUsed))}</span>
    </button>
  {/each}
</div>
<RouteStepsCard plan={plans[selectedIdx]} totalFare={calcTotalFare(plans[selectedIdx].linesUsed)} />

<style>.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}</style>
