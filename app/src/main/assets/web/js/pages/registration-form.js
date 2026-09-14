/**
 * 屏幕 04 · 报名信息
 * 线框：newUI/index.html #screen-register
 * 业务：按展商配置的报名收集项渲染表单，提交后写入报名记录并进入我的报名。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { loadingBlock, stateBlock, toast, statusTag, statusTone } from '../ui/components.js';
import { el, append, replace, formatDateWithWeekday } from '../core/dom.js';

export async function registrationFormPage(context) {
    const host = el('div', { class: 'stack' });
    scaffold({
        title: '报名信息',
        backTo: 'home',
        bodyProps: { 'data-gap': 'tight' },
        children: [host],
    });

    let exhibition = null;
    let fields = [];
    let existing = null;

    replace(host, loadingBlock(3));
    try {
        const data = await call('exhibitions.get', { id: context.params.id });
        if (!data?.found) {
            replace(host, stateBlock({
                tone: 'error',
                title: '展会不存在',
                description: data?.error || '无法加载报名信息。',
                action: { label: '返回首页', onClick: () => context.navigate('home') },
            }));
            return;
        }
        exhibition = data.exhibition;
        fields = data.fields || [];
        if (context.params.registrationId) {
            const record = await call('registrations.get', { id: context.params.registrationId });
            existing = record?.found ? record.registration : null;
        }
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
        const inputs = new Map();
        const form = el('form', { class: 'form', novalidate: true });
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
        const success = stateBlock({
            tone: 'success',
            iconName: 'check',
            title: '报名已提交',
            description: '需要审核的报名会在“我的报名”中显示状态。',
        });
        success.hidden = true;
        const submit = el('button', { class: 'cta', type: 'submit' }, ['提交报名']);

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
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '提交前确认展会名称与报名方式。' }),
        ]);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorBox.hidden = true;
            const answers = [];
            for (const field of fields) {
                const value = readValue(field, inputs);
                if (field.required && !value) {
                    errorBox.textContent = `请完成：${field.title}`;
                    errorBox.hidden = false;
                    inputs.get(field.title)?.focus?.();
                    return;
                }
                answers.push(`${field.title}：${value || '未填写'}`);
            }
            if (!exhibition.openForRegistration) {
                errorBox.textContent = '该展会当前不接受报名';
                errorBox.hidden = false;
                return;
            }

            const profile = state.user || {};
            const visitorName = profile.nickname || profile.username || '报名用户';
            submit.dataset.loading = 'true';
            submit.disabled = true;
            try {
                const result = await call('registrations.submit', {
                    exhibitionId: exhibition.id,
                    title: exhibition.title,
                    venue: exhibition.venue,
                    time: exhibition.time,
                    day: exhibition.day,
                    visitorName,
                    visitorType: `${profile.roleLabel || '普通用户'}`,
                    answers: answers.join('\n'),
                });
                if (!result?.ok) {
                    errorBox.textContent = result?.error || '提交失败';
                    errorBox.hidden = false;
                    return;
                }
                success.hidden = false;
                submit.textContent = '已提交 · 待审核';
                submit.disabled = true;
                toast('报名已提交', 'success');
                setTimeout(() => context.navigate('my-registrations', {}, { replace: true }), 900);
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.hidden = false;
            } finally {
                submit.dataset.loading = 'false';
            }
        });
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
        return list.length > 0 ? list : ['未设置选项'];
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
