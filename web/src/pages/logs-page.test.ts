/**
 * 最近日志页：统计、列表、空态、错误重试与级别筛选。
 *
 * 页面只依赖 `api.logs.list`（不走查询缓存），这里把它换成可控的 mock；
 * 渲染用真实组件（StatusTag、SegControl、StateBlock），验证屏幕上真的画出了这些信息。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import LogsPage from './LogsPage.vue';

const mocks = vi.hoisted(() => ({ logsList: vi.fn() }));

vi.mock('@/app/runtime', () => ({
  api: { logs: { list: mocks.logsList } },
}));

const MB = 1024 * 1024;

/** 服务器时间用不带时区的本地时间串，断言不会随测试机时区漂移。 */
const RESULT = {
  logs: [
    {
      id: 'log-1',
      level: 'info',
      category: 'auth',
      message: '用户登录成功',
      actorName: '管理员',
      actorId: 'u1',
      method: 'POST',
      path: '/auth/login',
      status: 200,
      ip: '10.0.0.1',
      createdAt: '2026-11-17T09:05:03',
    },
    {
      id: 'log-2',
      level: 'error',
      category: 'server',
      message: '数据库不可用',
      actorName: '',
      actorId: '',
      method: 'GET',
      path: '/exhibitions',
      status: 503,
      ip: '',
      createdAt: '2026-11-17T09:06:00',
    },
  ],
  stats: { storageMb: 64, usedBytes: 2 * MB, entryCount: 12, limitBytes: 64 * MB },
};

let app: App | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  await nextTick();
}

async function mountPage(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  app = createApp(LogsPage);
  app.mount(container);
  await flush();
  return container;
}

function buttonByText(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  );
}

describe('最近日志页', () => {
  it('渲染统计、级别、消息、请求行与操作人', async () => {
    mocks.logsList.mockResolvedValue(RESULT);
    const container = await mountPage();
    await vi.waitFor(() => expect(container.querySelectorAll('.log-row')).toHaveLength(2));

    // 只取最近 100 条；「全部」不把级别发给服务端。
    expect(mocks.logsList).toHaveBeenCalledTimes(1);
    expect(mocks.logsList).toHaveBeenCalledWith({ limit: 100, level: undefined });

    const text = container.textContent ?? '';
    expect(text).toContain('已存 12 条');
    expect(text).toContain('已用 2.0 MB / 上限 64.0 MB');
    expect(text).toContain('用户登录成功');
    expect(text).toContain('数据库不可用');
    expect(text).toContain('POST /auth/login');
    expect(text).toContain('GET /exhibitions');
    expect(text).toContain('分类：auth');
    expect(text).toContain('操作人：管理员');
    expect(text).toContain('IP：10.0.0.1');
    expect(text).toContain('HTTP 200');
    expect(text).toContain('2026年11月17日 09:05:03');
    // 没有操作人的日志退回「系统」；没有 IP 时不显示空占位。
    expect(text).toContain('操作人：系统');
    expect(text).not.toContain('IP： ·');
    expect(text).toContain('只显示最近 100 条日志');

    // 级别用信号灯文字表达，不只看颜色。
    const levels = [...container.querySelectorAll('.status-tag')].map((tag) => tag.textContent?.trim());
    expect(levels).toEqual(['信息', '错误']);
    expect(container.querySelector('.status-tag[data-tone="info"]')).not.toBeNull();
    expect(container.querySelector('.status-tag[data-tone="danger"]')).not.toBeNull();
  });

  it('没有日志时给出空态', async () => {
    mocks.logsList.mockResolvedValue({
      logs: [],
      stats: { storageMb: 64, usedBytes: 0, entryCount: 0, limitBytes: 64 * MB },
    });
    const container = await mountPage();
    await vi.waitFor(() => expect(container.textContent).toContain('还没有日志'));
    expect(container.querySelectorAll('.log-row')).toHaveLength(0);
    expect(container.textContent).toContain('已存 0 条');
  });

  it('加载失败时在原位重试，失败不清空已有内容', async () => {
    mocks.logsList.mockRejectedValueOnce(new Error('网络断开'));
    const container = await mountPage();
    await vi.waitFor(() => expect(container.textContent).toContain('日志加载失败'));
    expect(container.textContent).toContain('网络断开');

    mocks.logsList.mockResolvedValue(RESULT);
    buttonByText(container, '重试')?.click();
    await vi.waitFor(() => expect(container.querySelectorAll('.log-row')).toHaveLength(2));
    expect(mocks.logsList).toHaveBeenCalledTimes(2);
  });

  it('按级别筛选时把级别发给服务端，并切到对应空态', async () => {
    mocks.logsList.mockResolvedValue(RESULT);
    const container = await mountPage();
    await vi.waitFor(() => expect(container.querySelectorAll('.log-row')).toHaveLength(2));

    mocks.logsList.mockResolvedValue({
      logs: [],
      stats: { storageMb: 64, usedBytes: 2 * MB, entryCount: 0, limitBytes: 64 * MB },
    });
    container.querySelector<HTMLButtonElement>('.seg button[data-value="error"]')?.click();
    await vi.waitFor(() => expect(mocks.logsList).toHaveBeenCalledTimes(2));
    expect(mocks.logsList).toHaveBeenLastCalledWith({ limit: 100, level: 'error' });
    await vi.waitFor(() => expect(container.textContent).toContain('这个级别还没有日志'));
    expect(container.querySelectorAll('.log-row')).toHaveLength(0);

    // 切回「全部」时不带级别字段。
    container.querySelector<HTMLButtonElement>('.seg button[data-value="all"]')?.click();
    await vi.waitFor(() => expect(mocks.logsList).toHaveBeenCalledTimes(3));
    expect(mocks.logsList.mock.calls.at(-1)?.[0]).toEqual({ limit: 100, level: undefined });
  });
});
