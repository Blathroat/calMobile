/**
 * 屏幕 08 · 报名详情
 * 线框：newUI/remaining-ui.html #screen-registration-detail
 * 业务：查看完整报名回答，可撤销报名；已通过的报名是否需要重新审核由管理员设置决定。
 *
 * 展商在展会设置里开启“启用报名二维码”后，审核通过的报名会在这里展示报名码：
 * 用户现场出示，展商用展商后台的「核销报名码」扫描后状态变为“已参加”。
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
            registrationCodeCard(),
        ]);
        renderFooter();
    }

    /**
     * 报名码：仅在展商启用二维码、且报名已通过（或已核销）时展示。
     * 二维码由内置的 qrcode-generator 画到 canvas 上，内容与报名码文本完全一致。
     */
    function registrationCodeCard() {
        if (!record.checkInCode) {
            return null;
        }
        const attended = record.statusLabel === '已参加';
        const canvas = el('canvas', {
            class: 'qr-canvas',
            width: 480,
            height: 480,
            role: 'img',
            'aria-label': '报名二维码',
        });
        const card = el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '报名码' }),
                statusTag(attended ? '已核销' : '待核销', attended ? 'ok' : 'pending'),
            ]),
            el('div', { class: 'qr-wrap' }, [canvas]),
            el('code', { class: 'qr-code-text', text: record.checkInCode }),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: attended
                    ? '该报名码已核销，无需再次出示。'
                    : '现场向展商出示此码，扫码后报名状态会变为“已参加”。',
            }),
        ]);
        // 下一帧再画：画布挂到文档后才有真实的 CSS 尺寸。
        // 逐模块绘制与内置库的解码往返由 scripts/webui-render.test.js 覆盖。
        const paint = () => drawQr(canvas, record.checkInCode);
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(paint);
        } else {
            paint();
        }
        return card;
    }

    /** 用内置的 qrcode-generator 把报名码画成二维码；库缺失时降级为纯文本提示。 */
    function drawQr(canvas, text) {
        const generator = typeof window !== 'undefined' ? window.qrcode : null;
        if (typeof generator !== 'function') {
            replace(canvas.parentNode, [
                el('p', { class: 'field-hint', text: '二维码组件未加载，可让展商手动输入下方报名码。' }),
            ]);
            return;
        }
        let model;
        try {
            // 0 表示按内容自动选择版本，M 级纠错在屏幕与打印下都够用。
            model = generator(0, 'M');
            model.addData(text);
            model.make();
        } catch (error) {
            replace(canvas.parentNode, [
                el('p', { class: 'field-hint', text: `二维码生成失败：${error.message}` }),
            ]);
            return;
        }
        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }
        const modules = model.getModuleCount();
        const quiet = 4;
        const size = canvas.width / (modules + quiet * 2);
        // 二维码必须保持高对比：白底黑点，深色模式下也不跟随主题反色。
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#20252b';
        for (let row = 0; row < modules; row += 1) {
            for (let column = 0; column < modules; column += 1) {
                if (!model.isDark(row, column)) {
                    continue;
                }
                context.fillRect(
                    Math.round((column + quiet) * size),
                    Math.round((row + quiet) * size),
                    Math.ceil(size),
                    Math.ceil(size),
                );
            }
        }
    }

    function statusHint(status) {
        if (status === '待审核') {
            return '展商审核后会更新状态';
        }
        if (status === '已通过') {
            return state.review.canRevise ? '展商仍可修改审核结果' : '展商已完成审核';
        }
        if (status === '已参加') {
            return '展商已扫码核销，祝参展顺利';
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
