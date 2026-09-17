import { t } from '../core/strings.js';
/**
 * 屏幕 08 · 报名详情
 * 线框：newUI/remaining-ui.html #screen-registration-detail
 * 业务：查看完整报名回答，可撤销报名；已通过的报名是否需要重新审核由管理员设置决定。
 *
 * 展商在展会设置里开启“启用报名二维码”后，审核通过的报名会在这里展示报名码：
 * 用户现场出示，展商用展商后台的「核销报名码」扫描后状态变为“已参加”。
 *
 * 取数走 core/loadable.js：从「我的报名」点进来时数据已预热，页面同步出内容、不闪骨架屏。
 */

import { state } from '../core/bridge.js';
import { registrations } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { scaffold } from '../core/router.js';
import { confirmSheet, notFoundBlock, pageFoot, statusTag, statusTone, toast } from '../ui/components.js';
import { el, replace, answerLines, formatRecordDate } from '../core/dom.js';
import { REGISTRATION_STATUS } from '../core/status.js';
import { loadQrEncoder } from '../core/vendor.js';

export async function registrationDetailPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = pageFoot();
    scaffold({
        title: t('s_1e7myaa'),
        backTo: 'my-registrations',
        bodyProps: { 'data-gap': 'tight' },
        foot,
        children: [host],
    });

    let record = null;

    await loadInto(host, {
        read: registrations.get,
        params: context.params.id,
        rows: 3,
        errorTitle: t('s_kvpltc'),
        render: apply,
    });

    /** 报名数据到位后开画；缓存命中时 loadInto 会同步调用一次，因此没有空档。 */
    function apply(data) {
        if (!data?.found) {
            // 报名可能刚被撤销或删除：清掉旧记录与页脚按钮，避免留下可点的操作。
            record = null;
            replace(host, notFoundBlock({
                title: t('s_18st7j'),
                description: data?.error || t('s_11prq8e'),
                backLabel: t('s_qr7208'),
                onBack: () => context.navigate('my-registrations'),
            }));
            replace(foot, []);
            return;
        }
        record = data.registration;
        render();
    }

    function render() {
        const answers = answerLines(record.answers);
        replace(host, [
            el('div', { class: 'card', 'data-tone': 'fill' }, [
                el('strong', { text: record.exhibitionTitle }),
                el('span', { class: 'row-meta', text: `${formatRecordDate(record)} ${record.exhibitionTime}` }),
                el('span', { class: 'row-meta', text: record.exhibitionVenue }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_vrp4t3') }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    detailRow(t('s_33njx3'), record.visitorName),
                    detailRow(t('s_yz0sc5'), record.visitorType),
                    ...(answers.length > 0
                        ? answers.map((line) => detailRow(line.label || t('s_otl7kf'), line.value))
                        : [detailRow(t('s_otl7kf'), t('s_v8pba2'))]),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_c6rjk') }),
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
     * 二维码由内置的 qrcode-generator 画到 canvas 上，内容与报名码文本完全一致；
     * 该库按需加载，进入本页时才拉取，避免拖慢启动。
     */
    function registrationCodeCard() {
        if (!record.checkInCode) {
            return null;
        }
        const attended = record.statusLabel === REGISTRATION_STATUS.ATTENDED;
        const canvas = el('canvas', {
            class: 'qr-canvas',
            width: 480,
            height: 480,
            role: 'img',
            'aria-label': t('s_16uw4a2'),
        });
        const hint = el('p', {
            class: 'field-hint',
            style: { textAlign: 'center' },
            text: t('s_1wlb9mw'),
        });
        const card = el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: t('s_w5wyci') }),
                statusTag(attended ? t('s_107xpf9') : t('s_1qk0zaw'), attended ? 'ok' : 'pending'),
            ]),
            el('div', { class: 'qr-wrap' }, [canvas]),
            el('code', { class: 'qr-code-text', text: record.checkInCode }),
            hint,
        ]);

        loadQrEncoder()
            .then(() => {
                drawQr(canvas, record.checkInCode);
                hint.textContent = attended
                    ? t('s_132avex')
                    : t('s_aoirc6');
            })
            .catch((error) => {
                hint.textContent = `二维码组件加载失败（${error.message}），可让展商手动输入上方报名码。`;
            });
        return card;
    }

    /** 用内置的 qrcode-generator 把报名码画成二维码。 */
    function drawQr(canvas, text) {
        const generator = typeof window !== 'undefined' ? window.qrcode : null;
        if (typeof generator !== 'function') {
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
        if (status === REGISTRATION_STATUS.PENDING) {
            return t('s_1te6cde');
        }
        if (status === REGISTRATION_STATUS.APPROVED) {
            return state.review.canRevise ? t('s_i68x11') : t('s_1k42kcd');
        }
        if (status === REGISTRATION_STATUS.ATTENDED) {
            return t('s_1cjrrf7');
        }
        if (status === REGISTRATION_STATUS.CANCELLED) {
            return t('s_h2sz0p');
        }
        return t('s_1bzdeux');
    }

    function detailRow(label, value) {
        return el('div', { class: 'row' }, [
            el('span', { class: 'row-meta', style: { minWidth: '96px' }, text: label }),
            el('strong', { class: 'fill', text: value || '—' }),
        ]);
    }

    function renderFooter() {
        const cancelled = record.statusLabel === REGISTRATION_STATUS.CANCELLED;
        const revise = state.review.canRevise || record.statusLabel === REGISTRATION_STATUS.PENDING;

        const modify = el('button', {
            class: 'cta ghost',
            type: 'button',
            disabled: cancelled || !revise ? true : null,
            onclick: () => modifyRegistration(),
        }, [t('s_ebndq6')]);

        const cancel = el('button', {
            class: 'cta danger',
            type: 'button',
            disabled: cancelled ? true : null,
            onclick: () => askCancel(),
        }, [cancelled ? REGISTRATION_STATUS.CANCELLED : t('s_1u8rnsb')]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('div', { class: 'grid-cols-2' }, [modify, cancel]),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: cancelled ? t('s_ex1lrt') : t('s_131vhix'),
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
            title: t('s_1u8rnsb'),
            message: `确定撤销「${record.exhibitionTitle}」的报名吗？撤销后展商将不再审核该记录。`,
            confirmLabel: t('s_zfeh7n'),
            tone: 'danger',
            onConfirm: async () => {
                try {
                    const result = await registrations.cancel(record.id);
                    if (!result?.ok) {
                        toast(result?.error || t('s_qqaurb'), 'error');
                        return;
                    }
                    toast(t('s_xf7p1v'), 'success');
                    context.refresh();
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }
}
