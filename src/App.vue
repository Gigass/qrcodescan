<template>
  <div id="app">
    <router-view />
  </div>
</template>

<style>
:root {
  --bg-color: #f8fafc;
  --text-main: #1e293b;
  --text-muted: #64748b;
  --primary: #0f172a;
  --accent: #3b82f6;
  --surface: #ffffff;
  --border: #e2e8f0;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-color);
  color: var(--text-main);
  overflow: hidden; /* Prevent bounce on mobile */
}

button {
  font-family: inherit;
  border: none;
  outline: none;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

button:active {
  transform: scale(0.96);
}

/* Global Transition Utility */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>

