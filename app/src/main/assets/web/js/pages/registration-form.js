import { t } from '../core/strings.js';
/**
 * 屏幕 04 · 报名信息
 * 线框：newUI/index.html #screen-register
 * 业务：按展商配置的报名收集项渲染表单，提交后写入报名记录并进入我的报名。
 *
 * 取数走 core/loadable.js：展会与已有报名都命中缓存时同步出内容，从详情页切进来不闪骨架屏。
 */

import { state } from '../core/bridge.js';
import { exhibitions, registrations } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { scaffold, onPageStop } from '../core/router.js';
import { notFoundBlock, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, append, replace, formatDateWithWeekday } from '../core/dom.js';
import { EXHIBITION_STATUS } from '../core/status.js';
import { check, limit } from '../core/validate.js';

export async function registrationFormPage(context) {
    const host = el('div', { class: 'stack' });
    scaffold({
        title: t('s_vrp4t3'),
        backTo: 'home',
        bodyProps: { 'data-gap': 'tight' },
        children: [host],
    });

    let exhibition = null;
    let fields = [];
    let existing = null;
    /** 提交成功后的跳转定时器；用户在这之前离开本页就不再跳（见 onPageStop）。 */
    let redirectTimer = null;

    // 离开本页时取消尚未触发的跳转，避免把已经返回的用户再拽回「我的报名」。
    onPageStop(() => {
        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = null;
        }
    });

    const registrationId = context.params.registrationId;

    /**
     * 本页要的两份数据合成一次取数：展会（含收集项）与已有报名。
     * 两条都走 core/api.js 的只读缓存，因此不会为同一份数据发两次请求。
     */
    const readForm = async (params) => {
        const data = await exhibitions.get(params.id);
        // 展会不存在时不再去取报名，保持原来的请求顺序与「找不到展会」的提示。
        if (!data?.found || !registrationId) {
            return { data, existing: null };
        }
        const record = await registrations.get(registrationId);
        return { data, existing: record?.found ? record.registration : null };
    };

    /**
     * 首帧的同步取数：两份数据都在缓存里才算命中。
     * 只画一半会出现「表单先空着、随后才补上答案」的跳动，宁可让 loadInto 先出骨架屏。
     */
    readForm.peek = (params) => {
        const data = exhibitions.get.peek(params.id);
        const record = registrationId ? registrations.get.peek(registrationId) : null;
        if (data === undefined || (registrationId && record === undefined)) {
            return undefined;
        }
        return { data, existing: record?.found ? record.registration : null };
    };

    // 表单只建一次：loadInto 可能先画缓存、再画远端数据，
    // 第二帧直接跳过，否则会把用户已经填好的答案冲掉。
    let built = false;

    await loadInto(host, {
        read: readForm,
        params: { id: context.params.id },
        rows: 3,
        errorTitle: t('s_kvpltc'),
        render: (payload) => {
            if (!payload.data?.found) {
                replace(host, notFoundBlock({
                    title: t('s_1vim1qp'),
                    description: payload.data?.error || t('s_1px91rj'),
                    backLabel: t('s_17zyr1e'),
                    onBack: () => context.navigate('home'),
                }));
                return;
            }
            if (built) {
                return;
            }
            built = true;
            exhibition = payload.data.exhibition;
            fields = payload.data.fields || [];
            existing = payload.existing;
            render();
        },
    });

    function render() {
        const inputs = new Map();
        const form = el('form', { class: 'form', novalidate: true });
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
        const success = stateBlock({
            tone: 'success',
            iconName: 'check',
            title: t('s_gs61uj'),
            description: t('s_1qd14sn'),
        });
        success.hidden = true;
        const submit = el('button', { class: 'cta', type: 'submit' }, [t('s_1umrk9v')]);

        for (const field of fields) {
            const control = buildControl(field, inputs);
            append(form, control);
        }
        append(form, [errorBox, success, submit]);

        replace(host, [
            el('div', { class: 'card', 'data-tone': 'fill' }, [
                el('strong', { text: exhibition.title }),
                el('span', { class: 'row-meta', text: `${formatDateWithWeekday(exhibition.date)} ${exhibition.time} · ${exhibition.venue}` }),
                statusTag(exhibition.modeLabel || exhibition.status, statusTone(exhibition.status)),
            ]),
            form,
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: t('s_n6zeza') }),
        ]);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorBox.hidden = true;
            const answerLimit = limit('answer', 200);
            const answers = [];
            for (const field of fields) {
                const value = readValue(field, inputs);
                const error = check(value, {
                    label: field.title,
                    required: field.required,
                    max: field.type === '文本' ? answerLimit : 0,
                });
                if (error) {
                    errorBox.textContent = error;
                    errorBox.hidden = false;
                    focusField(field, inputs);
                    return;
                }
                answers.push(`${field.title}：${value || t('s_15h5nhd')}`);
            }
            if (!exhibition.openForRegistration) {
                errorBox.textContent = t('s_1b45hrg');
                errorBox.hidden = false;
                return;
            }

            const profile = state.user || {};
            const visitorName = profile.nickname || profile.username || t('s_jt5fam');
            const autoApprove = exhibition.status === EXHIBITION_STATUS.REVIEW_OPTIONAL;
            submit.dataset.loading = 'true';
            submit.disabled = true;
            try {
                const result = await registrations.submit({
                    exhibitionId: exhibition.id,
                    title: exhibition.title,
                    venue: exhibition.venue,
                    time: exhibition.time,
                    day: exhibition.day,
                    visitorName,
                    visitorType: `${profile.roleLabel || t('s_1cfg610')}`,
                    answers: answers.join('\n'),
                });
                if (!result?.ok) {
                    errorBox.textContent = result?.error || t('s_f66edb');
                    errorBox.hidden = false;
                    return;
                }
                const approved = result.autoApproved === true || autoApprove;
                success.querySelector('strong').textContent = approved ? t('s_hiwq5k') : t('s_gs61uj');
                success.querySelector('p').textContent = approved
                    ? t('s_1d9en33')
                    : t('s_1qd14sn');
                success.hidden = false;
                submit.textContent = approved ? t('s_f02bjx') : t('s_1vse82y');
                submit.disabled = true;
                toast(approved ? t('s_17txntc') : t('s_gs61uj'), 'success');
                // 提交成功后的 900ms 里用户可能已经按了返回：定时器要随页面一起停，
                // 否则会把用户从他自己的目标页面拽到「我的报名」。
                redirectTimer = setTimeout(() => {
                    redirectTimer = null;
                    context.navigate('my-registrations', {}, { replace: true });
                }, 900);
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.hidden = false;
            } finally {
                submit.dataset.loading = 'false';
            }
        });
    }

    /** 校验失败时把焦点移到对应控件，单选/多选聚焦到第一项。 */
    function focusField(field, inputs) {
        const control = inputs.get(field.title);
        if (!control) {
            return;
        }
        if (control.querySelector) {
            const inner = control.querySelector('input');
            (inner || control).focus?.();
            return;
        }
        control.focus?.();
    }

    function buildControl(field, inputs) {
        const id = `field-${field.title.replace(/\s+/g, '-')}`;
        const label = el('label', { for: id }, [
            field.title,
            field.required ? el('span', { class: 'required', 'aria-hidden': 'true', text: ' *' }) : null,
        ]);

        if (field.type === '单选') {
            const group = el('fieldset', { class: 'choice-group' }, [el('legend', { text: field.title })]);
            const row = el('div', { class: 'choice-row' });
            const options = splitOptions(field.options);
            options.forEach((option, index) => {
                const optionId = `${id}-${index}`;
                const input = el('input', {
                    type: 'radio',
                    name: id,
                    id: optionId,
                    value: option,
                });
                if (existing?.answers?.includes(option) || (!existing && index === 0 && field.required)) {
                    input.checked = true;
                }
                append(row, el('span', { class: 'choice' }, [
                    input,
                    el('label', { for: optionId, text: option }),
                ]));
            });
            append(group, row);
            inputs.set(field.title, row.querySelector('input'));
            return group;
        }

        if (field.type === '多选') {
            const group = el('fieldset', { class: 'choice-group' }, [el('legend', { text: field.title })]);
            const rows = el('div', { class: 'check-row' });
            splitOptions(field.options).forEach((option, index) => {
                const optionId = `${id}-${index}`;
                const input = el('input', { type: 'checkbox', id: optionId, value: option });
                if (existing?.answers?.includes(option)) {
                    input.checked = true;
                }
                append(rows, el('label', { class: 'check-label', for: optionId }, [input, option]));
            });
            append(group, rows);
            inputs.set(field.title, rows);
            return group;
        }

        const input = el('input', {
            class: 'input',
            id,
            type: 'text',
            placeholder: `请输入${field.title}`,
            maxlength: String(limit('answer', 200)),
        });
        if (existing) {
            const match = new RegExp(`${escapeRegExp(field.title)}：(.*)`).exec(existing.answers || '');
            input.value = match ? match[1].trim() : '';
        }
        inputs.set(field.title, input);
        return el('div', { class: 'field' }, [label, input]);
    }

    function readValue(field, inputs) {
        if (field.type === '单选') {
            const checked = document.querySelector(`input[name="field-${field.title.replace(/\s+/g, '-')}"]:checked`);
            return checked ? checked.value : '';
        }
        if (field.type === '多选') {
            const rows = inputs.get(field.title);
            if (!rows) {
                return '';
            }
            return Array.from(rows.querySelectorAll('input[type="checkbox"]:checked'))
                .map((box) => box.value)
                .join('、');
        }
        return (inputs.get(field.title)?.value || '').trim();
    }

    function splitOptions(options) {
        const list = String(options || '').split(',').map((item) => item.trim()).filter(Boolean);
        return list.length > 0 ? list : [t('s_q88a0n')];
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
