/**
 * 管理后台用户分区的展示与筛选控件（需求 3、11）。
 *
 * 行为基线：
 * - 状态只留在卡片右侧的 StatusTag，最近登录行不再重复状态；
 * - 日期后面跟上最近登录 IP 的地区（如「2026-11-17 江苏省苏州市」），地区为空只显示日期；
 * - 时间缺失时用注册时间兜底，真的取不到才显示「未知」。
 * - 搜索框下方一行放身份 / 状态两个选择栏，点开是带对勾的列表抽屉；纯展示 + 事件回抛，
 *   取数与地址栏留在 AdminPage。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import AdminUsersSection from './AdminUsersSection.vue';
import AppSheet from '@/components/AppSheet.vue';
import { closeSheet, sheet } from '@/services/sheet';
import { useBootstrapStore } from '@/stores/bootstrap';
import type { User } from '@/api/types';

let app: App | undefined;
/** 组件回抛的筛选事件（`role:xxx` / `status:xxx`）；每次挂载前清空。 */
const emitted: string[] = [];

beforeEach(() => {
  // 减少动效：抽屉关闭的退场计时器直接落 0，断言不用等动画时长。
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  if (sheet.current) closeSheet();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 等抽屉渲染与关闭的 0ms 计时器都跑完。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await nextTick();
}

interface MountOptions {
  /** 父组件下发的当前筛选值；空串表示「全部」。 */
  roleFilter?: string;
  statusFilter?: string;
  /** 搜索框里的关键字，用来断言空态文案。 */
  query?: string;
  /** 未筛选的完整数据；默认与 `userItems` 相同。 */
  data?: User[];
  agreement?: { enabled: boolean; version: number; updatedAt?: string };
}

/** 挂载分区，返回整张卡片的可见文本。`data` 与 `userItems` 不同时用来验证「计数取筛选后的条数」。 */
function mountCard(users: User[], options: MountOptions = {}): string {
  emitted.length = 0;
  document.body.innerHTML = '<div id="admin-users-test"></div>';
  const pinia = createPinia();
  setActivePinia(pinia);
  const agreement = options.agreement ?? { enabled: false, version: 0 };
  useBootstrapStore().apply({ agreement: { ...agreement, updatedAt: agreement.updatedAt ?? '' } });
  app = createApp({
    render: () => [
      h(AdminUsersSection, {
        users: { data: ref(options.data ?? users), error: ref(undefined), loading: ref(false) },
        userItems: users,
        query: options.query ?? '',
        roleFilter: options.roleFilter ?? '',
        statusFilter: options.statusFilter ?? '',
        copy: {
          adjustStatus: '调整状态',
          adjustRole: '调整权限',
          manageExhibitions: '管理展会',
          manageMeetings: '管理会议',
        },
        onChangeRole: (value: string) => emitted.push(`role:${value}`),
        onChangeStatus: (value: string) => emitted.push(`status:${value}`),
      }),
      // 筛选抽屉由外壳统一渲染：挂上来才能验证「点开 → 看到带对勾的选项 → 选中回抛」。
      h(AppSheet),
    ],
  });
  app.use(pinia);
  app.mount('#admin-users-test');
  return document.body.textContent ?? '';
}

function user(overrides: User): User {
  return { id: 'usr-test', nickname: '测试用户', roleCode: 'user', statusCode: 'active', ...overrides };
}

/** 身份 / 状态两个选择栏：与编辑展会页的活动分类同一套下划线触发按钮。 */
function roleTrigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#admin-user-role-filter')!;
}

function statusTrigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#admin-user-status-filter')!;
}

/** 两个选择栏所在的那一行：需求要求它们排成一行。 */
function filterRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.user-filter-row');
}

/** 抽屉里当前带对勾的选项文案。 */
function checkedOptionLabels(): string[] {
  return [...document.querySelectorAll('.sheet-actions button[data-checked="true"]')].map(
    (node) => node.textContent?.trim() ?? '',
  );
}

/** 抽屉里的某个选项按钮。 */
function sheetOption(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.sheet-actions button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!button) throw new Error(`抽屉里没有「${label}」选项`);
  return button;
}

describe('用户卡片最近登录', () => {
  it('日期后面追加地区，状态只出现在右侧标签里', () => {
    const text = mountCard([
      user({ statusCode: 'banned', lastLoginTime: '2026-11-17', lastLoginRegion: '江苏省苏州市' }),
    ]);
    expect(text).toContain('最近登录 2026-11-17 江苏省苏州市');
    // 以前是「封禁 · 最近登录 …」，状态文字不再进这一行
    expect(text).not.toContain('·');
    // 卡片右侧的 StatusTag 才是状态显示；筛选控件里的「封禁」是选项，不进卡片信息行。
    expect(document.querySelector('.status-tag')?.textContent?.trim()).toBe('封禁');
    const metas = [...document.querySelectorAll('.row-meta')].map((node) => node.textContent?.trim() ?? '');
    expect(metas).toContain('最近登录 2026-11-17 江苏省苏州市');
    expect(metas.some((meta) => meta.includes('封禁'))).toBe(false);
  });

  it('地区为空时只显示日期', () => {
    const text = mountCard([user({ lastLoginTime: '2026-11-17', lastLoginRegion: '' })]);
    expect(text).toContain('最近登录 2026-11-17');
    expect(text).not.toContain('2026-11-17 ');
  });

  it('内网来源显示「内网」，不下发 IP 原文', () => {
    const text = mountCard([user({ lastLoginTime: '2026-11-17', lastLoginRegion: '内网' })]);
    expect(text).toContain('最近登录 2026-11-17 内网');
    expect(text).not.toContain('127.0.0.1');
  });

  it('最近登录时间缺失时用注册时间兜底', () => {
    const text = mountCard([user({ lastLoginTime: '', registrationTime: '2026-01-02', lastLoginRegion: '' })]);
    expect(text).toContain('最近登录 2026-01-02');
    expect(text).not.toContain('未知');
  });

  it('卡片右侧的状态信号灯按账号状态上色，不是灰色', () => {
    mountCard([
      user({ id: 'u-active', statusCode: 'active' }),
      user({ id: 'u-limited', statusCode: 'limited' }),
      user({ id: 'u-banned', statusCode: 'banned' }),
    ]);
    const tones = [...document.querySelectorAll('.status-tag')].map((node) => node.getAttribute('data-tone'));
    expect(tones).toEqual(['ok', 'warn', 'danger']);
  });

  it('时间和注册时间都没有时才显示「未知」', () => {
    const text = mountCard([user({ lastLoginTime: '', registrationTime: '', lastLoginRegion: '' })]);
    expect(text).toContain('最近登录 未知');
  });
});

describe('用户筛选控件', () => {
  it('搜索框下方一行放身份与状态两个选择栏，默认都显示「全部」', () => {
    const text = mountCard([user({})]);
    const row = filterRow();
    expect(row).not.toBeNull();
    // 两个选择栏在同一个 .user-filter-row 里：宽屏并排、窄屏自动落成两行。
    expect([...row!.querySelectorAll('button')].map((node) => node.id)).toEqual([
      'admin-user-role-filter',
      'admin-user-status-filter',
    ]);
    expect(roleTrigger().textContent?.trim()).toBe('全部');
    expect(statusTrigger().textContent?.trim()).toBe('全部');
    expect(text).toContain('身份');
    expect(text).toContain('状态');
  });

  it('当前 props 的筛选值显示在选择栏上', () => {
    mountCard([user({})], { roleFilter: 'exhibitor', statusFilter: 'banned' });
    expect(roleTrigger().textContent?.trim()).toBe('展商');
    expect(statusTrigger().textContent?.trim()).toBe('封禁');
  });

  it('点开身份栏是带对勾的列表抽屉，选中后只回抛 change-role', async () => {
    mountCard([user({})]);
    roleTrigger().click();
    await flush();
    expect(sheet.current?.title).toBe('身份');
    expect([...document.querySelectorAll('.sheet-actions button')].map((node) => node.textContent?.trim())).toEqual([
      '全部',
      '普通用户',
      '展商',
      '管理员',
    ]);
    // 当前是「全部」：抽屉里只有这一项带对勾。
    expect(checkedOptionLabels()).toEqual(['全部']);

    sheetOption('管理员').click();
    await flush();
    expect(emitted).toEqual(['role:admin']);
    expect(sheet.current).toBeNull();
    expect(roleTrigger().textContent?.trim()).toBe('全部');
  });

  it('点开状态栏同样是带对勾的列表抽屉，选中后只回抛 change-status', async () => {
    mountCard([user({})], { statusFilter: 'limited' });
    statusTrigger().click();
    await flush();
    expect(sheet.current?.title).toBe('状态');
    expect(checkedOptionLabels()).toEqual(['受限']);

    sheetOption('封禁').click();
    await flush();
    expect(emitted).toEqual(['status:banned']);
    expect(sheet.current).toBeNull();
  });

  it('选中当前已经选中的那一项不再回抛变更，抽屉照常收起', async () => {
    mountCard([user({})], { roleFilter: 'user' });
    roleTrigger().click();
    await flush();
    sheetOption('普通用户').click();
    await flush();
    expect(emitted).toEqual([]);
    expect(sheet.current).toBeNull();
  });

  it('计数 pill 取筛选后的条数，而不是未筛选数据的总数', () => {
    const filtered = [user({ id: 'u1', nickname: '甲' }), user({ id: 'u2', nickname: '乙' })];
    const text = mountCard(filtered, {
      data: [...filtered, user({ id: 'u3', nickname: '丙' })],
      roleFilter: 'user',
      statusFilter: 'active',
    });
    expect(text).toContain('2 位用户');
    expect(text).not.toContain('3 位用户');
  });

  it('筛选生效且结果为空时用筛选空态，不复用关键字空态', () => {
    const text = mountCard([], { roleFilter: 'banned' });
    expect(text).toContain('没有符合筛选条件的用户');
    expect(text).not.toContain('没有找到与');
  });

  it('关键字与筛选同时生效时说明两者共同作用，没搜索时仍用原关键字空态', () => {
    const filtered = mountCard([], { query: 'demo', roleFilter: 'user' });
    expect(filtered).toContain('没有找到同时符合“demo”与筛选条件的用户');

    const searched = mountCard([], { query: 'demo' });
    expect(searched).toContain('没有找到与“demo”相关的用户');
  });

  it('没有任何条件且列表为空时保留原来的空态', () => {
    expect(mountCard([])).toContain('暂无用户数据');
  });
});
