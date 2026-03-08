<script lang="ts">
  import MapLibreMap from '$lib/components/MapLibreMap.svelte';
  import ChatInterface from '$lib/components/ChatInterface.svelte';
</script>

<svelte:head>
  <title>RegioRuta - MVP</title>
</svelte:head>

<main class="relative h-screen w-screen overflow-hidden bg-background-app">
  <!-- Map layer -->
  <MapLibreMap />

  <!-- Dynamic Chat Interface -->
  <ChatInterface />
</main>
