import { describe, expect, it } from 'vitest';
import { API_BASE } from './api-base';

describe('页面 API 基址', () => {
  it('应用、PWA 与报名站都用同源相对路径，不含域名', () => {
    expect(API_BASE).toBe('/api/v1');
  });
});
