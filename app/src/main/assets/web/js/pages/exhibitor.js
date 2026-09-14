/**
 * 屏幕 10 · 展商后台
 * 线框：newUI/remaining-ui.html #screen-exhibitor-backend
 * 业务：ExhibitionManager.listAll / updateStatus / delete，报名管理与展会编辑入口。
 */

import { call } from '../core/bridge.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, confirmSheet, openSheet, mediaBox } from '../ui/components.js';
import { el, replace } from '../core/dom.js';

export async function exhibitorPage(context) {
    const listHost = el('div', { class: 'stack' });
    scaffold({
        title: '展商后台',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('plus', '新建展会', () => context.navigate('exhibition-form', { mode: 'create' }))],
        foot: tabbar({ items: navItems(), active: 'exhibitor' }),
        children: [listHost],
    });

    replace(listHost, loadingBlock(3));
    try {
        const items = await call('exhibitions.list');
        if (items.length === 0) {
            replace(listHost, stateBlock({
                iconName: 'briefcase',
                title: '还没有举办中的展会',
                description: '创建第一个展会，配置日期、地点与报名收集项。',
                action: { label: '新建展会', onClick: () => context.navigate('exhibition-form', { mode: 'create' }) },
            }));
            return;
        }
        const total = items.reduce((sum, item) => sum + (item.registrationCount || 0), 0);
        replace(listHost, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '我举办的展会' }),
                el('span', { class: 'pill', text: `${items.length} 个 · ${total} 条报名` }),
            ]),
            el('div', { class: 'list', 'data-gap': 'sm' }, items.map((item) => card(item))),
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => context.navigate('exhibition-form', { mode: 'create' }),
            }, ['新建展会']),
        ]);
    } catch (error) {
        replace(listHost, stateBlock({
            tone: 'error',
            title: '展会列表加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
    }

    function card(item) {
        const wrapper = el('div', { class: 'card' }, [
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                style: { border: '0', padding: '0', background: 'transparent' },
                onclick: () => context.navigate('detail', { id: item.id }),
            }, [
                mediaBox({ src: item.imageUri, className: 'thumb thumb-cover' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${item.dateLabel} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                ]),
                statusTag(item.modeLabel, statusTone(item.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                actionButton('查看报名', () => context.navigate('review', { exhibitionId: item.id })),
                actionButton('编辑展会', () => context.navigate('exhibition-form', { id: item.id })),
                actionButton('报名方式', () => changeStatus(item)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                actionButton('编辑简介', () => context.navigate('rich-editor', { id: item.id })),
                actionButton('删除展会', () => askDelete(item), true),
            ]),
        ]);
        return wrapper;
    }

    function actionButton(label, onClick, danger = false) {
        return el('button', {
            class: `cta ${danger ? 'ghost' : 'ghost'}`,
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: onClick,
        }, [label]);
    }

    /** 报名方式：线框的“需审核 / 无需审核 / 仅展示”，另保留截止与结束状态。 */
    function changeStatus(item) {
        const options = [
            { value: '需审核', label: '需审核', description: '提交后等待展商审核' },
            { value: '无需审核', label: '无需审核', description: '提交后直接通过' },
            { value: '仅展示', label: '仅展示', description: '展示信息，不收集报名' },
            { value: '截止报名', label: '截止报名', description: '保留信息，停止收集报名' },
            { value: '已结束', label: '已结束', description: '展会已结束，不可报名' },
        ];
        const sheet = openSheet({
            title: '设置报名方式',
            content: [
                el('p', { class: 'row-meta', text: `${item.title} · 当前 ${item.status}` }),
                el('div', { class: 'list', 'data-gap': 'sm' }, options.map((option) => el('button', {
                    class: 'row-card',
                    type: 'button',
                    dataset: { pressable: 'true' },
                    onclick: async () => {
                        sheet.close();
                        await update(option.value);
                    },
                }, [
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: option.label }),
                        el('span', { class: 'row-meta', text: option.description }),
                    ]),
                    option.value === item.status ? statusTag('当前', 'pending') : null,
                ]))),
            ],
            actions: [{ label: '取消', onClick: (close) => close() }],
        });
    }

    async function update(status) {
        try {
            const ok = await call('exhibitions.status', { id: item.id, status });
            toast(ok ? '报名方式已更新' : '更新失败', ok ? 'success' : 'error');
            if (ok) {
                context.refresh();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function askDelete(item) {
        confirmSheet({
            title: '删除展会',
            message: `删除「${item.title}」后，展会信息与报名收集项都会移除，且无法恢复。`,
            confirmLabel: '删除',
            tone: 'danger',
            onConfirm: async () => {
                try {
                    const ok = await call('exhibitions.delete', { id: item.id });
                    toast(ok ? '展会已删除' : '删除失败', ok ? 'success' : 'error');
                    if (ok) {
                        context.refresh();
                    }
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }
}
