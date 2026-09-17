import { t } from '../core/strings.js';
/**
 * 屏幕 13 · 报名管理 / 审核
 * 线框：newUI/remaining-ui.html #screen-registration-management
 * 业务：RegistrationReviewStore，状态为待审核 / 已通过 / 已拒绝 / 已参加；
 * 展商能否重新审核由管理员设置决定，管理员自己不受该开关限制。
 */

import { call, state } from '../core/bridge.js';
import { exhibitions, review } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { loadErrorBlock, loadingBlock, openSheet, segmented, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, replace, answerLines, truncate } from '../core/dom.js';
import { REGISTRATION_STATUS, REVIEW_FILTERS } from '../core/status.js';

export async function reviewPage(context) {
    const exhibitionId = context.params.exhibitionId || '';
    // 管理员在管理后台查看报名时始终可以切换报名人状态。
    const isAdmin = state.user.can?.admin === true;
    const listHost = el('div', { class: 'stack' });
    const countPill = el('span', { class: 'pill', text: '—' });
    const filterHost = el('div');
    let filter = REGISTRATION_STATUS.PENDING;
    let filterSeg = null;
    let title = t('s_7xrrf0');
    let records = [];

    scaffold({
        title: t('s_7xrrf0'),
        backTo: isAdmin ? 'admin' : 'exhibitor',
        bodyProps: { 'data-gap': 'tight' },
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: state.brand.en }),
                    el('h2', { text: t('s_7xrrf0') }),
                ]),
                countPill,
            ]),
            el('p', { class: 'row-meta', text: t('s_1dkg6y4') }),
            isAdmin
                ? el('p', { class: 'field-hint', text: t('s_17zufsn') })
                : null,
            filterHost,
            listHost,
        ],
    });

    if (!exhibitionId) {
        // 未指定展会时，先让展商选择要审核的展会
        replace(listHost, loadingBlock(2));
        try {
            const items = await exhibitions.list();
            replace(filterHost, []);
            replace(listHost, [
                el('span', { class: 'section-label', text: t('s_1yn5q3y') }),
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
            replace(listHost, loadErrorBlock({
                title: t('s_kvpltc'),
                description: error.message,
                onRetry: () => context.refresh(),
            }));
        }
        return;
    }

    replace(listHost, loadingBlock(3));
    await load();

    function renderFilter(counts) {
        const labels = REVIEW_FILTERS.map((value) => {
            const count = value === '全部' ? (counts.total ?? 0) : (counts[value] ?? 0);
            return `${value} ${count}`;
        });
        if (!filterSeg) {
            filterSeg = segmented({
                label: t('s_1r4txyl'),
                value: filter,
                items: REVIEW_FILTERS.map((value) => ({ value, label: value })),
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
            const data = await review.list({ exhibitionId, status: filter });
            records = data.records || [];
            renderFilter(data.counts || {});
            countPill.textContent = `待审核 ${data.counts?.[REGISTRATION_STATUS.PENDING] ?? 0}`;
            if (title !== t('s_7xrrf0') && data.records?.length) {
                title = data.records[0].exhibitionTitle || title;
            }
            if (records.length === 0) {
                replace(listHost, stateBlock({
                    iconName: 'ticket',
                    title: `没有${filter === '全部' ? '' : filter}的报名`,
                    description: t('s_z599mr'),
                }));
                return;
            }
            replace(listHost, el('div', { class: 'list', 'data-gap': 'sm' }, records.map(row)));
        } catch (error) {
            replace(listHost, loadErrorBlock({
                title: t('s_1f0wrbh'),
                description: error.message,
                onRetry: () => load(),
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
            el('span', { class: 'avatar', text: (record.visitorName || t('s_18ko8bk')).slice(0, 1), 'aria-hidden': 'true' }),
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
        // 管理员始终可以切换状态；展商按“允许修改已通过或已拒绝的报名”开关决定。
        const revisable = isAdmin || record.status === REGISTRATION_STATUS.PENDING || state.review.canRevise;
        const attended = record.status === REGISTRATION_STATUS.ATTENDED;
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
                            el('span', { class: 'row-meta', style: { minWidth: '96px' }, text: line.label || t('s_otl7kf') }),
                            el('strong', { class: 'fill', text: line.value || '—' }),
                        ]))
                        : [el('span', { class: 'row-meta', text: t('s_v8pba2') })]),
                    revisable
                        ? el('div', { class: 'stack', 'data-gap': 'sm' }, [
                            el('div', { class: 'grid-cols-2' }, [
                                el('button', {
                                    class: 'cta ghost',
                                    type: 'button',
                                    onclick: async () => {
                                        sheet.close();
                                        await changeStatus(record, REGISTRATION_STATUS.REJECTED);
                                    },
                                }, [t('s_1qrntx4')]),
                                el('button', {
                                    class: 'cta',
                                    type: 'button',
                                    onclick: async () => {
                                        sheet.close();
                                        await changeStatus(record, REGISTRATION_STATUS.APPROVED);
                                    },
                                }, [t('s_j666m6')]),
                            ]),
                            el('button', {
                                class: 'cta ghost',
                                type: 'button',
                                disabled: attended ? true : null,
                                onclick: async () => {
                                    sheet.close();
                                    await changeStatus(record, REGISTRATION_STATUS.ATTENDED);
                                },
                            }, [attended ? t('s_dnmrxz') : t('s_crec0c')]),
                        ])
                        : el('p', { class: 'field-hint', text: t('s_1e05tqn') }),
                ]),
            ],
            actions: [{ label: t('s_g0fanx'), onClick: (close) => close() }],
        });
        return sheet;
    }

    async function changeStatus(record, status) {
        try {
            const result = await review.updateStatus(record.id, status);
            if (!result?.ok) {
                toast(result?.error || t('s_10lkv9z'), 'error');
                return;
            }
            toast(statusMessage(status), 'success');
            await load();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function statusMessage(status) {
        if (status === REGISTRATION_STATUS.APPROVED) {
            return t('s_1j0wkqr');
        }
        if (status === REGISTRATION_STATUS.REJECTED) {
            return t('s_yxll7l');
        }
        return `已将报名标记为${status}`;
    }
}
