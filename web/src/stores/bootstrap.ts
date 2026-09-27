import { defineStore } from 'pinia';
import type { Bootstrap, JsonObject } from '@/api/types';

export interface BootstrapState {
  booted: boolean;
  categories: unknown[];
  limits: JsonObject;
  brand: JsonObject;
  announcement: JsonObject;
  calendar: JsonObject;
  media: JsonObject;
  server: JsonObject;
  review: JsonObject;
}

export const useBootstrapStore = defineStore('bootstrap', {
  state: (): BootstrapState => ({
    booted: false,
    categories: [],
    limits: {},
    brand: { zh: '发现展会', en: 'calMobile' },
    announcement: {},
    calendar: {},
    media: {},
    server: {},
    review: {},
  }),
  actions: {
    apply(data: Bootstrap = {}) {
      this.booted = true;
      this.categories = Array.isArray(data.categories) ? data.categories : [];
      this.limits = { ...this.limits, ...asObject(data.limits) };
      this.brand = { ...this.brand, ...asObject(data.brand) };
      this.announcement = { ...this.announcement, ...asObject(data.announcement) };
      this.calendar = { ...this.calendar, ...asObject(data.calendar) };
      this.media = { ...this.media, ...asObject(data.media) };
      this.server = { ...this.server, ...asObject(data.server) };
      this.review = { ...this.review, ...asObject(data.review) };
    },
  },
});

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
