import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { useHint } from './useHint';

vi.mock('@/app/runtime', () => ({
  api: { profile: { markHint: vi.fn(async () => ({})) } },
}));

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('一次性提示', () => {
  it('访客关闭后保存在本机，重新进入时不再显示', async () => {
    setActivePinia(createPinia());
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
});
