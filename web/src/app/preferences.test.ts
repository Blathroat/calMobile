import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { saveAccentIndex, saveUiMode } from '@/app/preferences';
import { applyAccentIndex, applyMode } from '@/app/theme';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSettingsStore } from '@/stores/settings';
import { ApiError, TransportError } from '@/services/http-client';

const settingsApi = vi.hoisted(() => ({ saveUiMode: vi.fn(), saveUiTheme: vi.fn() }));
const session = vi.hoisted(() => ({ lifetime: new AbortController() }));
vi.mock('@/app/runtime', () => ({
  api: {
    settings: settingsApi,
    session: {
      get signal() {
        return session.lifetime.signal;
      },
    },
  },
}));
vi.mock('@/services/device-services', () => ({ device: { sync: vi.fn().mockResolvedValue({}) } }));

const colors = ['#c05621', '#2563eb', '#16a34a'];

function modeState() {
  return {
    store: useSettingsStore().mode,
    dom: document.documentElement.dataset.mode,
    cache: window.localStorage.getItem('calmobile.mode'),
    accentInk: document.documentElement.style.getPropertyValue('--accent-ink'),
  };
}

function accentState() {
  return {
    store: useBootstrapStore().theme.index,
    dom: document.documentElement.dataset.accent,
    cache: window.localStorage.getItem('calmobile.accent'),
    accent: document.documentElement.style.getPropertyValue('--accent'),
  };
}

function deferred() {
  let resolve!: (result: { ok: boolean; error?: string }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ ok: boolean; error?: string }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  session.lifetime.abort();
  session.lifetime = new AbortController();
  setActivePinia(createPinia());
  vi.clearAllMocks();
  settingsApi.saveUiMode.mockReset().mockResolvedValue({ ok: true });
  settingsApi.saveUiTheme.mockReset().mockResolvedValue({ ok: true });
  // Node 的实验性 Web Storage 可能遮住 jsdom；缓存用独立的浏览器存储替身。
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, String(value)),
  });
  useBootstrapStore().apply({ theme: { colors, index: 0 } });
  applyMode('auto');
  applyAccentIndex(0);
});

afterEach(() => vi.unstubAllGlobals());

describe.each([
  {
    name: '明暗模式',
    first: 'dark',
    second: 'light',
    save: (value: string | number) => saveUiMode(String(value)),
    api: settingsApi.saveUiMode,
    state: modeState,
  },
  {
    name: '强调色',
    first: 1,
    second: 2,
    save: (value: string | number) => saveAccentIndex(Number(value)),
    api: settingsApi.saveUiTheme,
    state: accentState,
  },
])('$name', ({ first, second, save, api, state }) => {
  it('立即应用选择，成功后保持 Pinia、页面与首帧缓存一致', async () => {
    const request = deferred();
    api.mockReturnValueOnce(request.promise);
    const original = state();
    const saving = save(first);
    const optimistic = state();
    request.resolve({ ok: true });
    await saving;
    expect(optimistic).not.toEqual(original);
    expect(state()).toEqual(optimistic);
    expect(api).toHaveBeenCalledWith(first);
  });

  it.each([
    new ApiError('账号不允许保存偏好', 403),
    new ApiError('偏好值不合法', 200),
    new TransportError('后端不可用'),
  ])('请求拒绝时回滚全部本地状态，并向页面保留异常 %s', async (reason) => {
    const original = state();
    api.mockRejectedValueOnce(reason);
    await expect(save(first)).rejects.toBe(reason);
    expect(state()).toEqual(original);
  });

  it('未确认保存成功的响应也回滚', async () => {
    const original = state();
    api.mockResolvedValueOnce({ ok: false, error: '保存失败' });
    await expect(save(first)).rejects.toThrow('保存失败');
    expect(state()).toEqual(original);
  });

  it('连续两次失败后恢复最近已保存值，不停留在第一次未保存的选择', async () => {
    const original = state();
    const earlier = deferred();
    const later = deferred();
    api.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    const firstSave = save(first);
    const secondSave = save(second);
    const observed = Promise.allSettled([firstSave, secondSave]);
    earlier.reject(new TransportError('第一次失败'));
    await firstSave.catch(() => undefined);
    later.reject(new TransportError('第二次失败'));
    await observed;
    expect(state()).toEqual(original);
  });

  it('连续选择按先后顺序写入，避免慢写入覆盖服务端的最新偏好', async () => {
    const earlier = deferred();
    api.mockReturnValueOnce(earlier.promise);
    const firstSave = save(first);
    const secondSave = save(second);
    await Promise.resolve();
    const writesBeforeFirstCompletion = api.mock.calls.map(([value]) => value);
    earlier.resolve({ ok: true });
    await Promise.all([firstSave, secondSave]);
    expect(writesBeforeFirstCompletion).toEqual([first]);
    expect(api.mock.calls.map(([value]) => value)).toEqual([first, second]);
  });

  it('旧请求失败不覆盖后续选择，后续成功仍可保存', async () => {
    const earlier = deferred();
    const later = deferred();
    api.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    const firstSave = save(first);
    const secondSave = save(second);
    const observed = Promise.allSettled([firstSave, secondSave]);
    const latest = state();
    earlier.resolve({ ok: false, error: '第一次失败' });
    await firstSave.catch(() => undefined);
    const afterEarlierFailure = state();
    later.resolve({ ok: true });
    await observed;
    expect(afterEarlierFailure).toEqual(latest);
    expect(state()).toEqual(latest);
    expect(api.mock.calls.map(([value]) => value)).toEqual([first, second]);
  });

  it('后续保存失败时回滚到前一次成功的选择', async () => {
    const earlier = deferred();
    const later = deferred();
    api.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    const firstSave = save(first);
    const firstState = state();
    const secondSave = save(second);
    const observed = Promise.allSettled([firstSave, secondSave]);
    earlier.resolve({ ok: true });
    await firstSave;
    later.reject(new TransportError('第二次失败'));
    await observed;
    expect(state()).toEqual(firstState);
  });

  it('退出后旧请求失败不回滚下一账号的外观', async () => {
    const oldRequest = deferred();
    api.mockReturnValueOnce(oldRequest.promise);
    const oldSave = save(first).catch((reason: unknown) => reason);
    await Promise.resolve();
    session.lifetime.abort();
    session.lifetime = new AbortController();
    applyMode('light');
    applyAccentIndex(2);
    const newAccount = state();
    oldRequest.reject(new TransportError('旧会话已退出', 'aborted'));
    await oldSave;
    expect(state()).toEqual(newAccount);
  });

  it('换号取消旧队列，新账号保存不用等旧请求结束', async () => {
    const oldRequest = deferred();
    api.mockReturnValueOnce(oldRequest.promise);
    const oldSave = save(first);
    const queuedSave = save(second);
    const observed = Promise.allSettled([oldSave, queuedSave]);
    await Promise.resolve();
    session.lifetime.abort();
    session.lifetime = new AbortController();
    applyMode('auto');
    applyAccentIndex(0);
    const newSave = save(first);
    await Promise.resolve();
    const writesBeforeOldCompletion = api.mock.calls.map(([value]) => value);
    oldRequest.resolve({ ok: true });
    const outcomes = await observed;
    await newSave;
    expect(writesBeforeOldCompletion).toEqual([first, first]);
    expect(api.mock.calls.map(([value]) => value)).toEqual([first, first]);
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } });
  });
});

it('明暗请求未完成时仍可保存强调色，失败只恢复对应偏好', async () => {
  const request = deferred();
  settingsApi.saveUiMode.mockReturnValueOnce(request.promise);
  const savingMode = saveUiMode('dark');
  const observed = savingMode.catch((reason: unknown) => reason);
  await saveAccentIndex(1);
  request.reject(new TransportError('保存明暗失败'));
  await observed;
  expect(useSettingsStore().mode).toBe('auto');
  expect(accentState()).toEqual({ store: 1, dom: '1', cache: colors[1], accent: colors[1] });
});
