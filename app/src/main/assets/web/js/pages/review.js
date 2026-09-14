/**
 * 屏幕 13 · 报名管理 / 审核
 * 线框：newUI/remaining-ui.html #screen-registration-management
 * 业务：RegistrationReviewStore，状态为待审核 / 已通过 / 已拒绝；是否允许重新审核由管理员设置决定。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, openSheet, segmented } from '../ui/components.js';
import { el, replace, answerLines, truncate } from '../core/dom.js';

const FILTERS = ['待审核', '已通过', '已拒绝', '全部'];

export async function reviewPage(context) {
    const exhibitionId = context.params.exhibitionId || '';
    const listHost = el('div', { class: 'stack' });
    const countPill = el('span', { class: 'pill', text: '—' });
    const filterHost = el('div');
    let filter = '待审核';
    let filterSeg = null;
    let title = '报名管理';
    let records = [];

    scaffold({
        title: '报名管理',
        backTo: 'exhibitor',
        bodyProps: { 'data-gap': 'tight' },
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: state.brand.en }),
                    el('h2', { text: '报名管理' }),
                ]),
                countPill,
            ]),
            el('p', { class: 'row-meta', text: '审核结果会同步到用户的“我的报名”，并触发状态通知。' }),
            filterHost,
            listHost,
        ],
    });

    if (!exhibitionId) {
        // 未指定展会时，先让展商选择要审核的展会
        replace(listHost, loadingBlock(2));
        try {
            const items = await call('exhibitions.list');
            replace(filterHost, []);
            replace(listHost, [
                el('span', { class: 'section-label', text: '选择要审核的展会' }),
                el('div', { class: 'list', 'data-gap': 'sm' }, items.map((item) => el('button', {
                    class: 'row-card',
                    type: 'button',
                    dataset: { pressable: 'true' },
                    onclick: () => context.navigate('review', { exhibitionId: item.id }),
                }, [
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title truncate', text: item.title }),
                        el('span', { class: 'row-meta', text: `${item.dateLabel} · ${item.registrationCount} 条报名` }),
                    ]),
                    statusTag(item.status, statusTone(item.status)),
                ]))),
            ]);
            countPill.textContent = `${items.length} 个展会`;
        } catch (error) {
            replace(listHost, stateBlock({
                tone: 'error',
                title: '加载失败',
                description: error.message,
                action: { label: '重试', onClick: () => context.refresh() },
            }));
        }
        return;
    }

    replace(listHost, loadingBlock(3));
    await load();

    function renderFilter(counts) {
        const labels = FILTERS.map((value) => `${value} ${counts[value] ?? (value === '全部' ? counts.total : 0) ?? 0}`);
        if (!filterSeg) {
            filterSeg = segmented({
                label: '审核状态',
                value: filter,
                items: FILTERS.map((value) => ({ value, label: value })),
                onChange: (value) => {
                    filter = value;
                    load();
                },
            });
            replace(filterHost, filterSeg);
        }
        // 文案先更新，再让滑块滑到当前状态，动画因此不会被重新渲染打断。
        filterSeg.querySelectorAll('button').forEach((button, index) => {
            button.textContent = labels[index];
        });
        filterSeg.setValue(filter, true);
    }

    async function load() {
        try {
            const data = await call('review.list', { exhibitionId, status: filter });
            records = data.records || [];
            renderFilter(data.counts || {});
            countPill.textContent = `待审核 ${data.counts?.['待审核'] ?? 0}`;
            if (title !== '报名管理' && data.records?.length) {
                title = data.records[0].exhibitionTitle || title;
            }
            if (records.length === 0) {
                replace(listHost, stateBlock({
                    iconName: 'ticket',
                    title: `没有${filter === '全部' ? '' : filter}的报名`,
                    description: '用户提交报名后会出现在这里，点击记录可查看完整回答。',
                }));
                return;
            }
            replace(listHost, el('div', { class: 'list', 'data-gap': 'sm' }, records.map(row)));
        } catch (error) {
            replace(listHost, stateBlock({
                tone: 'error',
                title: '报名列表加载失败',
                description: error.message,
                action: { label: '重试', onClick: () => load() },
            }));
        }
    }

    function row(record) {
        return el('button', {
            class: 'row-card',
            type: 'button',
            dataset: { pressable: 'true' },
            'aria-label': `查看 ${record.visitorName} 的报名详情`,
            onclick: () => openDetail(record),
        }, [
            el('span', { class: 'avatar', text: (record.visitorName || '报').slice(0, 1), 'aria-hidden': 'true' }),
            el('span', { class: 'row-copy' }, [
                el('strong', { class: 'row-title', text: record.visitorName }),
                el('span', { class: 'row-meta', text: `报名于 ${record.registrationTime}` }),
                el('span', { class: 'row-meta truncate', text: truncate(record.summary, 34) }),
            ]),
            statusTag(record.status, statusTone(record.status)),
        ]);
    }

    function openDetail(record) {
        const answers = answerLines(record.answers);
        const revisable = record.status === '待审核' || state.review.canRevise;
        const sheet = openSheet({
            title: record.visitorName,
            content: [
                el('div', { class: 'stack' }, [
                    el('div', { class: 'row', 'data-gap': 'md' }, [
                        statusTag(record.status, statusTone(record.status)),
                        el('span', { class: 'row-meta', text: `报名于 ${record.registrationTime}` }),
                    ]),
                    el('div', { class: 'card', 'data-tone': 'fill' }, answers.length > 0
                        ? answers.map((line) => el('div', { class: 'row' }, [
                            el('span', { class: 'row-meta', style: { minWidth: '96px' }, text: line.label || '补充信息' }),
                            el('strong', { class: 'fill', text: line.value || '—' }),
                        ]))
                        : [el('span', { class: 'row-meta', text: '未收集额外信息' })]),
                    revisable
                        ? el('div', { class: 'grid-cols-2' }, [
                            el('button', {
                                class: 'cta ghost',
                                type: 'button',
                                onclick: async () => {
                                    sheet.close();
                                    await changeStatus(record, '已拒绝');
                                },
                            }, ['拒绝']),
                            el('button', {
                                class: 'cta',
                                type: 'button',
                                onclick: async () => {
                                    sheet.close();
                                    await changeStatus(record, '已通过');
                                },
                            }, ['通过']),
                        ])
                        : el('p', { class: 'field-hint', text: '该报名已完成审核，管理员未开启“允许重新审核”。' }),
                ]),
            ],
            actions: [{ label: '关闭', onClick: (close) => close() }],
        });
        return sheet;
    }

    async function changeStatus(record, status) {
        try {
            const result = await call('review.updateStatus', { id: record.id, status });
            if (!result?.ok) {
                toast(result?.error || '更新失败', 'error');
                return;
            }
            toast(status === '已通过' ? '已通过该报名' : '已拒绝该报名', 'success');
            await load();
        } catch (error) {
            toast(error.message, 'error');
        }
    }
}
