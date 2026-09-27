<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <main class="app-shell">
    <RouterView />
  </main>
</template>

<style>
:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f7f6f3;
  color: #20252b;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
.app-shell { min-height: 100vh; }
</style>
