import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api, applyDocumentTitle, applyRuntimeBootstrap, bootApp, resetBootForTests } from './runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';

describe('app bootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetBootForTests();
    document.head.innerHTML = '';
    document.title = '';
    delete window.__CALMOBILE_BRANDING__;
  });

  it('shares one bootstrap promise and applies stores once', async () => {
    const bootstrap = vi.spyOn(api, 'bootstrap').mockResolvedValue({
      user: { id: 'u1', loggedIn: true, guest: false, role: 'user' },
      capabilities: { camera: true },
      brand: { zh: '测试' },
    });
    await Promise.all([bootApp(), bootApp()]);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(useSessionStore().loggedIn).toBe(true);
    expect(useSessionStore().role).toBe('user');
    bootstrap.mockRestore();
  });

  it('uses runtime branding for title and PWA meta', () => {
    document.head.innerHTML = [
      '<meta name="description" content="默认描述" />',
      '<meta name="apple-mobile-web-app-title" content="默认短名" />',
      '<meta name="theme-color" content="#111111" media="(prefers-color-scheme: light)" />',
      '<meta name="theme-color" content="#222222" media="(prefers-color-scheme: dark)" />',
    ].join('');
    applyRuntimeBootstrap({
      brand: { zh: '青枳' },
      branding: {
        appName: '活动排期助手',
        shortName: '青枳',
        description: '青枳 · 活动日历',
        themeColor: '#FDCC32',
        themeColorDark: '#101215',
      },
    });
    expect(document.title).toBe('青枳 · 活动排期助手');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('青枳 · 活动日历');
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('青枳');
    const themes = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(themes.find((item) => item.getAttribute('media')?.includes('light'))?.getAttribute('content')).toBe(
      '#FDCC32',
    );
    expect(themes.find((item) => item.getAttribute('media')?.includes('dark'))?.getAttribute('content')).toBe(
      '#101215',
    );
  });

  it('APP_TITLE overrides the brand prefix and injected runtime branding still applies before bootstrap', () => {
    window.__CALMOBILE_BRANDING__ = { appTitle: '青枳 · 活动排期助手' };
    applyDocumentTitle();
    expect(document.title).toBe('青枳 · 活动排期助手');
  });

  it('bootstrap 删掉品牌字段时 store 不保留旧值，也不回退到首帧注入的旧值', () => {
    window.__CALMOBILE_BRANDING__ = { appTitle: '旧标题' };
    applyRuntimeBootstrap({ branding: { appName: '活动排期助手' } });
    expect(useBootstrapStore().branding.appName).toBe('活动排期助手');
    applyRuntimeBootstrap({ branding: {} });
    expect(useBootstrapStore().branding.appName).toBeUndefined();
    expect(document.title).not.toBe('旧标题');
  });
});
