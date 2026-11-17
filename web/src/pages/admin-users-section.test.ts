/**
 * 管理后台用户卡片的「最近登录」一行（需求 11）。
 *
 * 行为基线：
 * - 状态只留在卡片右侧的 StatusTag，最近登录行不再重复状态；
 * - 日期后面跟上最近登录 IP 的地区（如「2026-11-17 江苏省苏州市」），地区为空只显示日期；
 * - 时间缺失时用注册时间兜底，真的取不到才显示「未知」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, ref, type App } from 'vue';
import AdminUsersSection from './AdminUsersSection.vue';
import type { User } from '@/api/types';

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

/** 挂载分区，返回整张卡片的可见文本。 */
function mountCard(users: User[]): string {
  document.body.innerHTML = '<div id="admin-users-test"></div>';
  app = createApp(AdminUsersSection, {
    users: { data: ref(users), error: ref(undefined), loading: ref(false) },
    userItems: users,
    query: '',
    copy: {
      adjustStatus: '调整状态',
      adjustRole: '调整权限',
      manageExhibitions: '管理展会',
      manageMeetings: '管理会议',
    },
  });
  app.mount('#admin-users-test');
  return document.body.textContent ?? '';
}

function user(overrides: User): User {
  return { id: 'usr-test', nickname: '测试用户', roleCode: 'user', statusCode: 'active', ...overrides };
}

describe('用户卡片最近登录', () => {
  it('日期后面追加地区，状态只出现在右侧标签里', () => {
    const text = mountCard([
      user({ statusCode: 'banned', lastLoginTime: '2026-11-17', lastLoginRegion: '江苏省苏州市' }),
    ]);
    expect(text).toContain('最近登录 2026-11-17 江苏省苏州市');
    // 以前是「封禁 · 最近登录 …」，状态文字不再进这一行
    expect(text).not.toContain('·');
    // 卡片右侧的 StatusTag 仍然是唯一的状态显示
    expect(text.split('封禁').length - 1).toBe(1);
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
