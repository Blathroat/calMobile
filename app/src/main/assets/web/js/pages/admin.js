/**
 * 屏幕 15 · 管理后台（用户 / 展会）
 * 线框：newUI/remaining-ui.html #screen-admin-backend
 * 业务：AdminUserManager 用户状态管理、ExhibitionManager 展会管理。
 * 展会卡片与展商后台保持一致；搜索、暂停与导出直接内联在本页，不再进入二级页面。
 */

import { call } from '../core/bridge.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, openSheet, segmented, confirmSheet } from '../ui/components.js';
import { el, replace, truncate, formatDateWithWeekday } from '../core/dom.js';

const USER_STATUSES = ['正常', '受限', '封禁'];

export async function adminPage(context) {
    const host = el('div', { class: 'stack' });
    let tab = context.params.tab || '用户';
    let query = '';

    scaffold({
        title: '管理后台',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
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
                ],
                onChange: (value) => {
                    tab = value;
                    query = '';
                    renderTabs();
                },
            }),
            el('div', { class: 'stack', id: 'admin-panel' }),
        ]);
        loadPanel();
    }

    async function loadPanel() {
        const panel = host.querySelector('#admin-panel');
        if (!panel) {
            return;
        }
        replace(panel, loadingBlock(3));
        try {
            if (tab === '用户') {
                await renderUsers(panel);
            } else {
                await renderExhibitions(panel);
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
        const users = await call('users.list', { query });
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
                smallButton('管理', () => manageUser(user)),
                smallButton('公开页', () => context.navigate('user-public', { userId: user.id })),
            ]),
        ])));

        replace(panel, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '用户管理' }),
                el('span', { class: 'pill', text: `${users.length} 位用户` }),
            ]),
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-user-search', text: '搜索用户' }),
                searchInput('admin-user-search', '昵称或邮箱', (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('p', { class: 'row-meta', text: '账号状态、权限与最近登录；状态变更会立即写入本地数据库。' }),
            users.length > 0
                ? cards
                : stateBlock({ title: query ? `没有找到与“${query}”相关的用户` : '暂无用户数据' }),
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
        const items = await call('exhibitions.list', { query });
        replace(panel, [
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-exhibition-search', text: '搜索展会' }),
                searchInput('admin-exhibition-search', '展会名称、地点或分类', (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '全部展会' }),
                el('span', { class: 'pill', text: `${items.length} 个展会` }),
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: '管理员暂停报名' }),
                el('span', { text: '暂停后普通用户不可报名，展商不可自行恢复。' }),
            ]),
            items.length > 0
                ? el('div', { class: 'list', 'data-gap': 'sm' }, items.map(exhibitionCard))
                : stateBlock({
                    iconName: 'search',
                    title: query ? `没有找到与“${query}”相关的展会` : '暂无展会数据',
                    description: query ? '换个关键词，或清空搜索查看全部展会。' : '展商创建展会后会出现在这里。',
                }),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: (event) => exportCsv(event.currentTarget),
            }, ['导出 CSV']),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '导出内容为当前展会列表，文件通过系统保存对话框写入。' }),
        ]);
    }

    /** 与展商后台一致的展会卡片：信息 + 查看报名 / 编辑 / 暂停报名。 */
    function exhibitionCard(item) {
        return el('div', { class: 'card' }, [
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                style: { border: '0', padding: '0', background: 'transparent' },
                onclick: () => context.navigate('detail', { id: item.id }),
            }, [
                el('span', { class: 'thumb ph-img', 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${formatDateWithWeekday(item.date)} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                ]),
                statusTag(item.modeLabel || item.status, statusTone(item.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallButton('查看报名', () => context.navigate('review', { exhibitionId: item.id })),
                smallButton('编辑展会', () => context.navigate('exhibition-form', { id: item.id })),
                smallButton(item.openForRegistration ? '暂停报名' : '恢复报名', () => toggleLock(item)),
            ]),
        ]);
    }

    function toggleLock(item) {
        const nextStatus = item.openForRegistration ? '截止报名' : '需审核';
        const title = item.openForRegistration ? '暂停报名' : '恢复报名';
        const message = item.openForRegistration
            ? `暂停后「${item.title}」不可报名，展商不能自行恢复。`
            : `恢复后「${item.title}」将重新按需审核的方式收集报名。`;
        confirmSheet({
            title,
            message,
            confirmLabel: title,
            onConfirm: async () => {
                try {
                    const ok = await call('exhibitions.status', { id: item.id, status: nextStatus });
                    toast(ok ? `已${title}` : '操作失败', ok ? 'success' : 'error');
                    if (ok) {
                        loadPanel();
                    }
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }

    async function exportCsv(button) {
        button.dataset.loading = 'true';
        try {
            const result = await call('export.csv', { type: 'exhibitions' });
            toast(`已导出 ${result.rows} 行到 ${result.fileName}`, 'success');
        } catch (error) {
            if (String(error.message).includes('取消')) {
                toast('已取消导出');
            } else {
                toast(error.message, 'error');
            }
        } finally {
            button.dataset.loading = 'false';
        }
    }

    // ── 小工具 ─────────────────────────────────────────────────────

    function smallButton(label, onClick) {
        return el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: onClick,
        }, [label]);
    }

    /** 搜索框带 220ms 防抖，避免每次按键都触发一次桥接。 */
    function searchInput(id, placeholder, onChange) {
        const input = el('input', { class: 'input', id, type: 'search', placeholder, autocomplete: 'off' });
        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => onChange(input.value.trim()), 220);
        });
        return input;
    }
}
