/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 * 线框：newUI/remaining-ui.html #screen-exhibition-form
 * 业务：ExhibitionManager.add/update + ExhibitionConfiguration（日期、报名起止、收集项）。
 */

import { call } from '../core/bridge.js';
import { scaffold, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, toast } from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';
import { plainText } from '../core/sanitize.js';

const MODES = [
    { value: '需审核', label: '需审核' },
    { value: '无需审核', label: '无需审核' },
    { value: '仅展示', label: '仅展示' },
];

export async function exhibitionFormPage(context) {
    const isCreate = !context.params.id;
    const host = el('div', { class: 'stack' });
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });
    const saveButton = topAction('save', isCreate ? '创建展会' : '保存展会', () => submit());

    scaffold({
        title: isCreate ? '新建展会' : '编辑展会',
        backTo: 'exhibitor',
        bodyProps: { 'data-gap': 'tight' },
        actions: [saveButton],
        foot,
        children: [host],
    });

    const model = {
        id: '',
        title: '',
        venue: '',
        date: '',
        time: '09:00-17:00',
        status: '需审核',
        category: '',
        description: '',
        registrationStart: '',
        registrationEnd: '',
    };
    let fields = [];

    replace(host, loadingBlock(4));
    try {
        if (!isCreate) {
            const data = await call('exhibitions.get', { id: context.params.id });
            if (!data?.found) {
                replace(host, stateBlock({
                    tone: 'error',
                    title: '展会不存在',
                    description: data?.error || '无法加载展会信息。',
                    action: { label: '返回展商后台', onClick: () => context.navigate('exhibitor') },
                }));
                return;
            }
            const item = data.exhibition;
            Object.assign(model, {
                id: item.id,
                title: item.title,
                venue: item.venue,
                date: item.date,
                time: item.time,
                status: MODES.some((mode) => mode.value === item.status) ? item.status : '需审核',
                category: item.category || '',
                description: item.description || '',
                registrationStart: item.registrationStart || '',
                registrationEnd: item.registrationEnd || '',
            });
            fields = (data.fields || []).map((field) => ({ ...field }));
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

    // ── 表单控件 ───────────────────────────────────────────────────

    const titleInput = textInput('form-title', 'text', model.title, '例如：智能制造与工业自动化展');
    const venueInput = textInput('form-venue', 'text', model.venue, '例如：上海新国际博览中心 · N3 馆');
    const dateInput = textInput('form-date', 'date', model.date);
    const timeInput = textInput('form-time', 'text', model.time, '09:00-17:00');
    const startInput = textInput('form-reg-start', 'date', model.registrationStart);
    const endInput = textInput('form-reg-end', 'date', model.registrationEnd);
    const categoryInput = textInput('form-category', 'text', model.category, '例如：智能制造 / 工业自动化');
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const fieldsHost = el('div', { class: 'stack', 'data-gap': 'sm' });

    const modeHost = el('div', { class: 'seg', role: 'group', 'aria-label': '报名方式' });
    const modeHint = el('p', { class: 'field-hint', text: hintFor(model.status) });
    const modeButtons = MODES.map((mode) => el('button', {
        type: 'button',
        'aria-pressed': mode.value === model.status ? 'true' : 'false',
        onclick: () => {
            model.status = mode.value;
            modeButtons.forEach((button, index) => {
                button.setAttribute('aria-pressed', MODES[index].value === model.status ? 'true' : 'false');
            });
            modeHint.textContent = hintFor(model.status);
        },
    }, [mode.label]));
    append(modeHost, modeButtons);

    const descriptionPreview = el('p', { class: 'row-meta' });
    const descriptionButton = el('button', {
        class: 'cta ghost',
        type: 'button',
        disabled: isCreate ? true : null,
        onclick: () => context.navigate('rich-editor', { id: model.id }),
    }, [isCreate ? '保存后可编辑简介' : '编辑富文本与媒体']);

    render();

    function render() {
        updateDescriptionPreview();
        renderFields();
        replace(host, [
            el('div', { class: 'form' }, [
                field('展会名称', titleInput, true),
                field('地点', venueInput, true),
                el('div', { class: 'grid-cols-2' }, [
                    field('开展日期', dateInput, true),
                    field('开展时间', timeInput),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    field('报名开始', startInput),
                    field('报名截止', endInput, false, '截止后用户不可再提交报名'),
                ]),                el('div', { class: 'field' }, [el('label', { text: '报名方式' }), modeHost, modeHint]),
                field('展会分类', categoryInput, false, '分类用于首页与搜索筛选'),
                errorBox,
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '展会介绍' }),
                descriptionPreview,
                descriptionButton,
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: '报名收集项' }),
                    el('span', { class: 'pill', text: `${fields.length} 项` }),
                ]),
                el('p', { class: 'field-hint', text: '收集项决定报名页展示的字段；删除全部后使用默认三项。' }),
                fieldsHost,
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    onclick: () => {
                        fields.push({ title: '', type: '文本', required: false, options: '' });
                        renderFields();
                    },
                }, ['新增收集项']),
            ]),
        ]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => submit(),
            }, [isCreate ? '创建展会' : '保存展会']),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '保存后可在展会详情页确认展示效果。' }),
        ]));
    }

    function updateDescriptionPreview() {
        descriptionPreview.textContent = model.description
            ? (plainText(model.description, 70) || '已配置富文本简介')
            : '还没有填写简介，可在富文本编辑器中插入图片与列表。';
    }

    function renderFields() {
        replace(fieldsHost, fields.map((item, index) => el('div', { class: 'card', 'data-tone': 'fill' }, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('strong', { text: item.title || `收集项 ${index + 1}` }),
                el('button', {
                    class: 'icon-button',
                    type: 'button',
                    'aria-label': '删除该收集项',
                    onclick: () => {
                        fields.splice(index, 1);
                        renderFields();
                    },
                }, [el('span', { text: '×', style: { fontSize: '20px' } })]),
            ]),
            textInput(`field-title-${index}`, 'text', item.title, '字段标题', (value) => {
                item.title = value;
            }),
            el('div', { class: 'grid-cols-2' }, [
                selectInput(`field-type-${index}`, ['文本', '单选', '多选'], item.type, (value) => {
                    item.type = value;
                }),
                selectInput(`field-req-${index}`, ['选填', '必填'], item.required ? '必填' : '选填', (value) => {
                    item.required = value === '必填';
                }),
            ]),
            textInput(`field-options-${index}`, 'text', item.options, '选项用英文逗号分隔（单选 / 多选）', (value) => {
                item.options = value;
            }),
        ])));
    }

    async function submit() {
        errorBox.hidden = true;
        const payload = {
            id: model.id,
            title: titleInput.value.trim(),
            venue: venueInput.value.trim(),
            date: dateInput.value,
            day: Number(dateInput.value.slice(8, 10)) || 0,
            time: timeInput.value.trim(),
            status: model.status,
            category: categoryInput.value.trim(),
            description: model.description,
            registrationStart: startInput.value,
            registrationEnd: endInput.value,
            fields: fields.filter((item) => item.title.trim() !== ''),
        };
        if (!payload.title) {
            return fail('请填写展会名称', titleInput);
        }
        if (!payload.date) {
            return fail('请选择开展日期', dateInput);
        }
        if (payload.registrationStart && payload.registrationEnd
            && payload.registrationEnd < payload.registrationStart) {
            return fail('报名截止日期不能早于开始日期', endInput);
        }
        saveButton.disabled = true;
        try {
            const result = await call('exhibitions.save', payload);
            if (!result?.ok) {
                saveButton.disabled = false;
                return fail(result?.error || '保存失败');
            }
            model.id = result.exhibition.id;
            model.description = result.exhibition.description || model.description;
            toast(isCreate ? '展会已创建' : '展会已保存', 'success');
            if (isCreate) {
                context.navigate('exhibition-form', { id: model.id }, { replace: true });
            } else {
                context.navigate('exhibitor', {}, { replace: true });
            }
        } catch (error) {
            saveButton.disabled = false;
            fail(error.message);
        }
    }

    function fail(message, control) {
        errorBox.textContent = message;
        errorBox.hidden = false;
        control?.focus?.();
        toast(message, 'error');
    }

    // ── 控件工厂 ───────────────────────────────────────────────────

    function textInput(id, type, value, placeholder, onInput) {
        const control = el('input', { class: 'input', id, type, placeholder, value: value || '' });
        if (onInput) {
            control.addEventListener('input', () => onInput(control.value));
        }
        return control;
    }

    function selectInput(id, options, value, onChange) {
        const control = el('select', { class: 'select', id });
        for (const option of options) {
            const node = el('option', { value: option, text: option });
            if (option === value) {
                node.selected = true;
            }
            append(control, node);
        }
        control.addEventListener('change', () => onChange(control.value));
        return control;
    }
}

function field(label, control, required, hint) {
    return el('div', { class: 'field' }, [
        el('label', { for: control.id }, [label, required
            ? el('span', { class: 'required', 'aria-hidden': 'true', text: ' *' })
            : null]),
        control,
        hint ? el('p', { class: 'field-hint', text: hint }) : null,
    ]);
}

function hintFor(status) {
    if (status === '需审核') {
        return '用户提交后进入待审核，展商在报名管理中通过或拒绝。';
    }
    if (status === '无需审核') {
        return '用户提交后直接视为通过，仍可在报名管理中调整。';
    }
    return '只展示展会信息，报名入口保持禁用。';
}
