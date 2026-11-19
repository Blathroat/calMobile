/**
 * 管理后台用户分区的展示与筛选控件（需求 3、11）。
 *
 * 行为基线：
 * - 状态只留在卡片右侧的 StatusTag，最近登录行不再重复状态；
 * - 日期后面跟上最近登录 IP 的地区（如「2026-11-17 江苏省苏州市」），地区为空只显示日期；
 * - 时间缺失时用注册时间兜底，真的取不到才显示「未知」。
 * - 搜索框下方是身份 / 状态两组筛选：纯展示 + 事件回抛，取数与地址栏留在 AdminPage。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, ref, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import AdminUsersSection from './AdminUsersSection.vue';
import { useBootstrapStore } from '@/stores/bootstrap';
import type { User } from '@/api/types';

let app: App | undefined;
/** 组件回抛的筛选事件（`role:xxx` / `status:xxx`）；每次挂载前清空。 */
const emitted: string[] = [];

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

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
  app = createApp(AdminUsersSection, {
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
  });
  app.use(pinia);
  app.mount('#admin-users-test');
  return document.body.textContent ?? '';
}

function user(overrides: User): User {
  return { id: 'usr-test', nickname: '测试用户', roleCode: 'user', statusCode: 'active', ...overrides };
}

/** 两组筛选控件（身份在前、状态在后）。 */
function segGroups(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.seg')];
}

function pressedLabels(): string[] {
  return [...document.querySelectorAll('.seg button[aria-pressed="true"]')].map(
    (node) => node.textContent?.trim() ?? '',
  );
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
  it('搜索框下方渲染身份与状态两组筛选，默认都选「全部」', () => {
    const text = mountCard([user({})]);
    const groups = segGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0]?.getAttribute('aria-label')).toBe('身份');
    expect(groups[1]?.getAttribute('aria-label')).toBe('状态');
    expect([...groups[0]!.querySelectorAll('button')].map((node) => node.textContent?.trim())).toEqual([
      '全部',
      '普通用户',
      '展商',
      '管理员',
    ]);
    expect([...groups[1]!.querySelectorAll('button')].map((node) => node.textContent?.trim())).toEqual([
      '全部',
      '正常',
      '受限',
      '封禁',
    ]);
    // 两个「全部」都是选中态，其余没有默认选中
    expect(pressedLabels()).toEqual(['全部', '全部']);
    expect(text).toContain('身份');
    expect(text).toContain('状态');
  });

  it('当前 props 的筛选值反映到选中态上', () => {
    mountCard([user({})], { roleFilter: 'exhibitor', statusFilter: 'banned' });
    expect(pressedLabels()).toEqual(['展商', '封禁']);
  });

  it('点击筛选项只回抛变更事件：身份走 change-role，状态走 change-status', () => {
    mountCard([user({})]);
    document.querySelector<HTMLButtonElement>('.seg button[data-value="admin"]')?.click();
    document.querySelector<HTMLButtonElement>('.seg button[data-value="limited"]')?.click();
    expect(emitted).toEqual(['role:admin', 'status:limited']);
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
