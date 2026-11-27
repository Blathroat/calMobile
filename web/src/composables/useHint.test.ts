import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { useHint } from './useHint';

vi.mock('@/app/runtime', () => ({
  api: { profile: { markHint: vi.fn(async () => ({})) } },
}));

/** 冷启动：会话与启动数据落定后，访客分支才允许显示提示。 */
function markBooted(): void {
  useBootstrapStore().booted = true;
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('一次性提示', () => {
  it('启动数据落定前不显示访客提示，落定后才显示', () => {
    setActivePinia(createPinia());
    const scope = effectScope();
    const hint = scope.run(() => useHint('registration-form'))!;

    expect(hint.visible.value).toBe(false);
    markBooted();
    expect(hint.visible.value).toBe(true);
    scope.stop();
  });

  it('访客关闭后保存在本机，重新进入时不再显示', async () => {
    setActivePinia(createPinia());
    markBooted();
    const scope = effectScope();
    const hint = scope.run(() => useHint('registration-form'))!;

    expect(hint.visible.value).toBe(true);
    await hint.dismiss();

    expect(hint.visible.value).toBe(false);
    expect(JSON.parse(localStorage.getItem('calmobile.seen-hints') || '[]')).toContain('registration-form');
    expect(api.profile.markHint).not.toHaveBeenCalled();

    scope.stop();
    const nextScope = effectScope();
    const nextHint = nextScope.run(() => useHint('registration-form'))!;
    expect(nextHint.visible.value).toBe(false);
    nextScope.stop();
  });

  it('登录用户继续把已读状态保存到账号', async () => {
    setActivePinia(createPinia());
    useSessionStore().applyUser({ id: '7', loggedIn: true, seenHints: [] });
    const scope = effectScope();
    const hint = scope.run(() => useHint('exhibition-detail'))!;

    await hint.dismiss();

    expect(useSessionStore().user.seenHints).toContain('exhibition-detail');
    expect(api.profile.markHint).toHaveBeenCalledWith('exhibition-detail');
    expect(localStorage.getItem('calmobile.seen-hints')).toBeNull();
    scope.stop();
  });

  it('登录用户冷启动不会先闪一次账号上已读的提示', () => {
    setActivePinia(createPinia());
    markBooted();
    const session = useSessionStore();
    // 冷启动首帧：会话还是空；提示在账号上已读过（本机键为空）。
    const scope = effectScope();
    const hint = scope.run(() => useHint('home-calendar-swipe'))!;
    expect(session.loggedIn).toBe(false);
    expect(hint.visible.value).toBe(true);

    // bootstrap 落定：账号态覆盖，提示立刻收起，不需要等本机键。
    session.applyUser({ id: '7', loggedIn: true, seenHints: ['home-calendar-swipe'] });
    expect(hint.visible.value).toBe(false);
    scope.stop();
  });
});
