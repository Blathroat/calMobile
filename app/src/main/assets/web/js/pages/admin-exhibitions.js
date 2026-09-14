/**
 * 屏幕 16 · 展会管理（管理员）
 * 线框：newUI/remaining-ui.html #screen-admin-exhibitions
 * 业务：管理员搜索展会、暂停/恢复报名（锁定）与导出 CSV。
 */

import { call } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, confirmSheet } from '../ui/components.js';
import { el, append, replace, formatDateWithWeekday } from '../core/dom.js';

export async function adminExhibitionsPage(context) {
    const listHost = el('div', { class: 'stack' });
    const countPill = el('span', { class: 'pill', text: '—' });
    const queryInput = el('input', {
        class: 'input',
        id: 'admin-exhibition-search',
        type: 'search',
        placeholder: '搜索展会名称、地点或分类',
    });
    const exportButton = el('button', {
        class: 'cta ghost',
        type: 'button',
        onclick: () => exportCsv(exportButton),
    }, ['导出 CSV']);

    const foot = el('div', { class: 'stack', 'data-gap': 'sm', style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });

    scaffold({
        title: '展会管理',
        backTo: 'admin',
        bodyProps: { 'data-gap': 'tight' },
        foot,
        children: [
            el('div', { class: 'field' }, [el('label', { for: 'admin-exhibition-search', text: '搜索展会' }), queryInput]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '全部展会' }),
                countPill,
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: '管理员暂停报名' }),
                el('span', { text: '暂停后普通用户不可报名，展商不可自行恢复。' }),
            ]),
            listHost,
        ],
    });

    replace(foot, [
        exportButton,
        el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '导出内容为当前展会列表，文件通过系统保存对话框写入。' }),
    ]);

    let items = [];
    let query = '';
    let timer = null;

    queryInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            query = queryInput.value.trim();
            load();
        }, 220);
    });

    await load();

    async function load() {
        replace(listHost, loadingBlock(3));
        try {
            items = await call('exhibitions.list', { query });
            countPill.textContent = `${items.length} 个展会`;
            if (items.length === 0) {
                replace(listHost, stateBlock({
                    iconName: 'search',
                    title: query ? `没有找到与“${query}”相关的展会` : '暂无展会数据',
                    description: query ? '换个关键词，或清空搜索查看全部展会。' : '展商创建展会后会出现在这里。',
                }));
                return;
            }
            replace(listHost, el('div', { class: 'list', 'data-gap': 'sm' }, items.map(card)));
        } catch (error) {
            replace(listHost, stateBlock({
                tone: 'error',
                title: '展会列表加载失败',
                description: error.message,
                action: { label: '重试', onClick: () => load() },
            }));
        }
    }

    function card(item) {
        return el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                el('span', { class: 'thumb ph-img thumb-sm', 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${formatDateWithWeekday(item.date)} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                ]),
                statusTag(item.modeLabel || item.status, statusTone(item.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                actionButton(item.openForRegistration ? '暂停报名' : '恢复报名', () => toggleLock(item)),
                actionButton('查看报名', () => context.navigate('review', { exhibitionId: item.id })),
                actionButton('编辑展会', () => context.navigate('exhibition-form', { id: item.id })),
            ]),
        ]);
    }

    function actionButton(label, onClick) {
        return el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: onClick,
        }, [label]);
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
                        await load();
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

    void append;
}
