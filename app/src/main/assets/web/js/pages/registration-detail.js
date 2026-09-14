/**
 * 屏幕 08 · 报名详情
 * 线框：newUI/remaining-ui.html #screen-registration-detail
 * 业务：查看完整报名回答，可撤销报名；已通过的报名是否需要重新审核由管理员设置决定。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, toast, confirmSheet } from '../ui/components.js';
import { el, replace, answerLines, formatDateWithWeekday } from '../core/dom.js';

export async function registrationDetailPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });
    scaffold({
        title: '报名详情',
        backTo: 'my-registrations',
        bodyProps: { 'data-gap': 'tight' },
        foot,
        children: [host],
    });

    replace(host, loadingBlock(3));
    let record = null;
    try {
        const data = await call('registrations.get', { id: context.params.id });
        if (!data?.found) {
            replace(host, stateBlock({
                tone: 'error',
                title: '报名记录不存在',
                description: data?.error || '该记录可能已被撤销。',
                action: { label: '返回列表', onClick: () => context.navigate('my-registrations') },
            }));
            return;
        }
        record = data.registration;
    } catch (error) {
        replace(host, stateBlock({
            tone: 'error',
            title: '加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
        return;
    }

    render();

    function render() {
        const answers = answerLines(record.answers);
        replace(host, [
            el('div', { class: 'card', 'data-tone': 'fill' }, [
                el('strong', { text: record.exhibitionTitle }),
                el('span', { class: 'row-meta', text: `${formatDateWithWeekday(`2026-06-${String(record.exhibitionDay).padStart(2, '0')}`)} ${record.exhibitionTime}` }),
                el('span', { class: 'row-meta', text: record.exhibitionVenue }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '报名信息' }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    detailRow('报名人', record.visitorName),
                    detailRow('身份', record.visitorType),
                    ...(answers.length > 0
                        ? answers.map((line) => detailRow(line.label || '补充信息', line.value))
                        : [detailRow('补充信息', '未收集额外信息')]),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '当前状态' }),
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    statusTag(record.statusLabel, statusTone(record.statusLabel)),
                    el('span', { class: 'row-meta', text: statusHint(record.statusLabel) }),
                ]),
            ]),
        ]);
        renderFooter();
    }

    function statusHint(status) {
        if (status === '待审核') {
            return '展商审核后会更新状态';
        }
        if (status === '已通过') {
            return state.review.canRevise ? '展商仍可修改审核结果' : '展商已完成审核';
        }
        if (status === '已撤销') {
            return '该报名已由你撤销';
        }
        return '如需修改请联系展商';
    }

    function detailRow(label, value) {
        return el('div', { class: 'row' }, [
            el('span', { class: 'row-meta', style: { minWidth: '96px' }, text: label }),
            el('strong', { class: 'fill', text: value || '—' }),
        ]);
    }

    function renderFooter() {
        const cancelled = record.statusLabel === '已撤销';
        const revise = state.review.canRevise || record.statusLabel === '待审核';

        const modify = el('button', {
            class: 'cta ghost',
            type: 'button',
            disabled: cancelled || !revise ? true : null,
            onclick: () => modifyRegistration(),
        }, ['修改报名']);

        const cancel = el('button', {
            class: 'cta danger',
            type: 'button',
            disabled: cancelled ? true : null,
            onclick: () => askCancel(),
        }, [cancelled ? '已撤销' : '撤销报名']);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('div', { class: 'grid-cols-2' }, [modify, cancel]),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: cancelled ? '撤销后的报名不会出现在展商审核列表。' : '撤销后如需参加请重新提交报名。',
            }),
        ]));
    }

    function modifyRegistration() {
        context.navigate('registration-form', {
            id: context.params.exhibitionId || '',
            registrationId: record.id,
        });
    }

    function askCancel() {
        confirmSheet({
            title: '撤销报名',
            message: `确定撤销「${record.exhibitionTitle}」的报名吗？撤销后展商将不再审核该记录。`,
            confirmLabel: '确认撤销',
            tone: 'danger',
            onConfirm: async () => {
                try {
                    const result = await call('registrations.cancel', { id: record.id });
                    if (!result?.ok) {
                        toast(result?.error || '撤销失败', 'error');
                        return;
                    }
                    toast('报名已撤销', 'success');
                    context.refresh();
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }
}
