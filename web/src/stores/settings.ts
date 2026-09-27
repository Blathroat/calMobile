import { defineStore } from 'pinia';
import type { JsonObject } from '@/api/types';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    theme: {} as JsonObject,
    ui: { mode: 'auto' } as JsonObject,
  }),
  getters: {
    mode: (state) => String(state.ui.mode ?? 'auto'),
  },
  actions: {
    apply(settings: JsonObject = {}) {
      if (settings.theme && typeof settings.theme === 'object') this.theme = { ...this.theme, ...settings.theme as JsonObject };
      if (settings.ui && typeof settings.ui === 'object') this.ui = { ...this.ui, ...settings.ui as JsonObject };
    },
    setMode(mode: 'auto' | 'light' | 'dark') {
      this.ui.mode = mode;
    },
  },
});
