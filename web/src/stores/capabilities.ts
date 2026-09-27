import { defineStore } from 'pinia';
import type { JsonObject } from '@/api/types';

export const useCapabilitiesStore = defineStore('capabilities', {
  state: () => ({ values: {} as JsonObject }),
  getters: {
    has: (state) => (name: string) => state.values[name] === true,
  },
  actions: {
    apply(values: JsonObject = {}) {
      this.values = { ...this.values, ...values };
    },
  },
});
