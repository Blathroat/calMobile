/**
 * 屏幕 15 · 管理后台（用户 / 展会 / 设置）
 * 线框：newUI/remaining-ui.html #screen-admin-backend
 * 业务：AdminUserManager 用户状态管理、ExhibitionManager 展会管理、AppSettings 应用设置。
 */

import { call } from '../core/bridge.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, openSheet, segmented } from '../ui/components.js';
import { el, replace, truncate } from '../core/dom.js';

const USER_STATUSES = ['正常', '受限', '封禁'];

export async function adminPage(context) {
    const host = el('div', { class: 'stack' });
    let tab = context.params.tab || '用户';

    scaffold({
        title: '管理后台',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('settings', '系统设置', () => context.navigate('admin-settings'))],
        foot: tabbar({ items: navItems(), active: 'admin' }),
        children: [host],
    });

    renderTabs();

    function renderTabs() {
        replace(host, [
            segmented({
                label: '管理分区',
                value: tab,
                items: [
                    { value: '用户', label: '用户' },
                    { value: '展会', label: '展会' },
                    { value: '设置', label: '设置' },
                ],
                onChange: (value) => {
                    tab = value;
                    renderTabs();
                },
            }),
            el('div', { class: 'stack', id: 'admin-panel' }),
        ]);
        loadPanel();
    }

    async function loadPanel() {
        const panel = host.querySelector('#admin-panel');
        replace(panel, loadingBlock(3));
        try {
            if (tab === '用户') {
                await renderUsers(panel);
            } else if (tab === '展会') {
                await renderExhibitions(panel);
            } else {
                renderSettings(panel);
            }
        } catch (error) {
            replace(panel, stateBlock({
                tone: 'error',
                title: '加载失败',
                description: error.message,
                action: { label: '重试', onClick: () => loadPanel() },
            }));
        }
    }

    // ── 用户管理 ───────────────────────────────────────────────────

    async function renderUsers(panel) {
        const users = await call('users.list');
        const cards = el('div', { class: 'list', 'data-gap': 'sm' }, users.map((user) => el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                el('span', { class: 'avatar', text: (user.nickname || '用').slice(0, 1), 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: `${user.nickname} · ${user.role}` }),
                    el('span', { class: 'row-meta', text: `${user.status} · 最近登录 ${user.lastLoginTime || '未知'}` }),
                    el('span', { class: 'row-meta truncate', text: truncate(user.email, 40) }),
                ]),
                statusTag(user.status, statusTone(user.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
                    onclick: () => manageUser(user),
                }, ['管理']),
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
                    onclick: () => context.navigate('user-public', { userId: user.id }),
                }, ['公开页']),
            ]),
        ])));

        replace(panel, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '用户管理' }),
                el('span', { class: 'pill', text: `${users.length} 位用户` }),
            ]),
            el('p', { class: 'row-meta', text: '账号状态、权限与最近登录；状态变更会立即写入本地数据库。' }),
            users.length > 0 ? cards : stateBlock({ title: '暂无用户数据' }),
        ]);
    }

    function manageUser(user) {
        const sheet = openSheet({
            title: `管理 ${user.nickname}`,
            content: [
                el('div', { class: 'stack' }, [
                    el('p', { class: 'row-meta', text: `${user.role} · 注册于 ${user.registrationTime || '未知'}` }),
                    el('div', { class: 'list', 'data-gap': 'sm' }, USER_STATUSES.map((status) => el('button', {
                        class: 'row-card',
                        type: 'button',
                        dataset: { pressable: 'true' },
                        onclick: async () => {
                            sheet.close();
                            await updateUserStatus(user, status);
                        },
                    }, [
                        el('span', { class: 'row-copy' }, [
                            el('strong', { class: 'row-title', text: status }),
                            el('span', { class: 'row-meta', text: statusHint(status) }),
                        ]),
                        user.status === status ? statusTag('当前', 'pending') : null,
                    ]))),
                ]),
            ],
            actions: [{ label: '取消', onClick: (close) => close() }],
        });
    }

    function statusHint(status) {
        if (status === '正常') {
            return '可正常浏览与报名';
        }
        if (status === '受限') {
            return '保留登录，限制部分操作';
        }
        return '禁止登录与报名';
    }

    async function updateUserStatus(user, status) {
        try {
            const ok = await call('users.status', { id: user.id, status });
            toast(ok ? `已将 ${user.nickname} 设为${status}` : '更新失败', ok ? 'success' : 'error');
            if (ok) {
                loadPanel();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    // ── 展会管理 ───────────────────────────────────────────────────

    async function renderExhibitions(panel) {
        const items = await call('exhibitions.list');
        replace(panel, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '展会管理' }),
                el('span', { class: 'pill', text: `全部 ${items.length}` }),
            ]),
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                onclick: () => context.navigate('admin-exhibitions'),
            }, [
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: '搜索、暂停与导出' }),
                    el('span', { class: 'row-meta', text: '进入展会管理页可筛选、锁定和导出 CSV' }),
                ]),
                el('span', { class: 'dim', 'aria-hidden': 'true', text: '›' }),
            ]),
            el('div', { class: 'list', 'data-gap': 'sm' }, items.slice(0, 4).map((item) => el('div', { class: 'row-card' }, [
                el('span', { class: 'thumb ph-img thumb-sm', 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${item.dateLabel} · ${item.registrationCount} 条报名` }),
                ]),
                statusTag(item.modeLabel || item.status, statusTone(item.status)),
            ]))),
        ]);
    }

    // ── 系统设置（摘要，完整表单在系统设置页） ─────────────────────

    function renderSettings(panel) {
        replace(panel, [
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '系统设置' }),
                el('p', { class: 'row-meta', text: '应用配色、启动公告、展会分类、审核策略与富文本媒体限制统一在系统设置页维护。' }),
                el('button', {
                    class: 'cta',
                    type: 'button',
                    onclick: () => context.navigate('admin-settings'),
                }, ['打开系统设置']),
            ]),
        ]);
    }
}
