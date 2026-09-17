/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 * 线框：newUI/remaining-ui.html #screen-exhibition-form
 * 业务：ExhibitionManager.add/update + ExhibitionConfiguration（日期、报名起止、收集项）。
 *
 * 展商后台卡片上的“报名方式”“编辑简介”“删除展会”都收进本页的「报名与简介设置」栏，
 * 展商从这里统一维护展会配置，卡片只需要两个入口。
 */

import { call } from '../core/bridge.js';
import { scaffold, topAction } from '../core/router.js';
import {
    icon,
    loadingBlock,
    stateBlock,
    switchRow,
    openSheet,
    confirmSheet,
    toast,
} from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';
import { markdownSummary } from '../core/markdown.js';
import { fieldValidator, validateAll, limit, allowedFormats, PATTERNS } from '../core/validate.js';

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
        imageUri: '',
        registrationStart: '',
        registrationEnd: '',
        qrEnabled: false,
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
                imageUri: item.imageUri || '',
                registrationStart: item.registrationStart || '',
                registrationEnd: item.registrationEnd || '',
                qrEnabled: item.qrEnabled === true,
            });
            fields = (data.fields || []).map((field) => ({
                title: field.title || '',
                type: field.type || '文本',
                required: field.required === true,
                // 选项在模型里统一为数组，界面上按条目增删。
                options: normalizeOptions(field.options),
            }));
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

    const descriptionPreview = el('p', { class: 'row-meta' });
    const descriptionButton = el('button', {
        class: 'cta ghost',
        type: 'button',
        style: { minHeight: '44px', fontSize: 'var(--fs-label)' },
        disabled: isCreate ? true : null,
        onclick: () => context.navigate('rich-editor', { id: model.id }),
    }, [isCreate ? '保存后可编辑' : '编辑简介']);

    // 「报名方式」一行的两个可变节点：就地更新，避免重建页面丢掉未保存的输入。
    const modeTag = el('span', [statusTagFor(model.status)]);
    const modeSummary = el('span', { class: 'fill' }, [
        el('span', { class: 'row-meta', text: hintFor(model.status) }),
    ]);

    const coverPreview = el('div', { class: 'cover-preview' });
    const coverHint = el('p', {
        class: 'field-hint',
        text: `建议使用 1080×1920（9:16）的竖版图片，当前允许 ${formatsHint()}。`,
    });

    render();

    function formatsHint() {
        const list = allowedFormats('image');
        return list.length > 0 ? list.map((item) => `.${item}`).join('/') : '常见图片格式';
    }

    function renderCover() {
        replace(coverPreview, [
            model.imageUri
                ? el('div', { class: 'hero ph-img hero-compact' }, [el('img', { src: model.imageUri, alt: '展会封面' })])
                : el('div', { class: 'hero ph-img hero-compact', 'aria-hidden': 'true' }),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                coverButton(),
                model.imageUri
                    ? el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
                        onclick: () => {
                            model.imageUri = '';
                            renderCover();
                        },
                    }, ['移除封面'])
                    : null,
            ]),
        ]);
    }

    function coverButton() {
        const button = el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: () => pickCover(button),
        }, [model.imageUri ? '更换封面' : '上传封面']);
        return button;
    }

    /** 封面直接落盘成短 URL，避免把图片塞进简介或展会记录。 */
    async function pickCover(button) {
        button.disabled = true;
        try {
            const stored = await call('media.import', { kind: 'image' });
            if (!stored?.url) {
                toast('未能读取所选图片', 'error');
                return;
            }
            model.imageUri = stored.url;
            renderCover();
            toast(stored.compressed ? '封面已压缩并上传' : '封面已上传', 'success');
        } catch (error) {
            if (String(error.message).includes('取消')) {
                return;
            }
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    // ── 前端校验：上限来自「管理-设置」的服务器设置 ────────────────

    const validators = [
        fieldValidator({
            control: titleInput,
            label: '展会名称',
            required: true,
            max: limit('exhibitionTitle', 60),
        }),
        fieldValidator({
            control: venueInput,
            label: '展会地点',
            required: true,
            max: limit('exhibitionVenue', 60),
        }),
        fieldValidator({
            control: dateInput,
            label: '开展日期',
            required: true,
            pattern: PATTERNS.date,
            patternMessage: '请选择开展日期',
        }),
        fieldValidator({
            control: timeInput,
            label: '开展时间',
            max: 20,
            pattern: PATTERNS.timeRange,
            patternMessage: '请按 09:00-17:00 的格式填写',
        }),
        fieldValidator({
            control: endInput,
            label: '报名截止日期',
            custom: () => {
                const start = startInput.value;
                const end = endInput.value;
                if (start && end && end < start) {
                    return '报名截止日期不能早于开始日期';
                }
                return '';
            },
        }),
        fieldValidator({
            control: categoryInput,
            label: '展会分类',
            max: limit('category', 20),
            pattern: PATTERNS.category,
            patternMessage: '分类只能包含中英文、数字与常见分隔符',
        }),
        fieldValidator({
            control: startInput,
            label: '报名开始日期',
            custom: () => {
                if (startInput.value && dateInput.value && startInput.value > dateInput.value) {
                    return '报名开始日期不能晚于展会开展日期';
                }
                return '';
            },
        }),
    ];

    function validateFieldTitles() {
        const max = limit('fieldTitle', 30);
        for (const item of fields) {
            const title = String(item.title || '').trim();
            if (title.length === 0) {
                continue;
            }
            if (title.length > max) {
                return `收集项标题最多 ${max} 个字符`;
            }
        }
        return '';
    }

    function render() {
        updateDescriptionPreview();
        renderFields();
        renderCover();
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
                ]),
                field('展会分类', categoryInput, false, '分类用于首页与搜索筛选'),
                errorBox,
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: '展会封面' }),
                    el('span', { class: 'pill', text: '1080 × 1920' }),
                ]),
                coverPreview,
                coverHint,
            ]),
            settingsCard(),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: '报名收集项' }),
                    el('span', { class: 'pill', text: `${fields.length} 项` }),
                ]),
                el('p', { class: 'field-hint', text: '收集项决定报名页展示的字段；单选与多选可逐条增删选项，删除全部后使用默认三项。' }),
                fieldsHost,
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    onclick: () => {
                        fields.push({ title: '', type: '文本', required: false, options: [] });
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
            ? (markdownSummary(model.description, 70) || '已配置 Markdown 简介')
            : '还没有填写简介，可用 Markdown 编辑并插入图片。';
    }

    /**
     * 报名与简介设置：展商后台卡片上的“报名方式”“编辑简介”“删除展会”都收在这里。
     * 新建展会时先保存，保存后按钮自动切换成可用状态。
     */
    function settingsCard() {
        const qrSwitch = switchRow({
            id: 'form-qr-enabled',
            label: '启用报名二维码',
            description: '开启后，报名审核通过的用户会在报名详情里看到报名码，展商可在现场扫码核销。',
            checked: model.qrEnabled,
            onChange: (value) => {
                model.qrEnabled = value;
                replace(qrHint, el('p', {
                    class: 'field-hint',
                    text: qrHintText(),
                }));
            },
        });
        const qrHint = el('div', [el('p', { class: 'field-hint', text: qrHintText() })]);

        return el('div', { class: 'card' }, [
            el('span', { class: 'section-label', text: '报名与简介设置' }),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('strong', { text: '报名方式' }),
                    el('button', {
                        class: 'pill',
                        type: 'button',
                        text: '修改',
                        onclick: () => openModeSheet(),
                    }),
                ]),
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    modeTag,
                    modeSummary,
                ]),
            ]),
            el('hr', { class: 'divider' }),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('strong', { text: '展会简介' }),
                    descriptionButton,
                ]),
                descriptionPreview,
            ]),
            el('hr', { class: 'divider' }),
            qrSwitch,
            qrHint,
            el('hr', { class: 'divider' }),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: '危险操作' }),
                el('button', {
                    class: 'cta danger',
                    type: 'button',
                    disabled: isCreate ? true : null,
                    onclick: () => askDelete(),
                }, [isCreate ? '保存后可删除展会' : '删除展会']),
                el('p', {
                    class: 'field-hint',
                    text: isCreate
                        ? '展会创建后才会写入记录，届时可以在这里删除。'
                        : '删除后展会信息、报名收集项与二维码开关都会移除，且无法恢复。',
                }),
            ]),
        ]);
    }

    function qrHintText() {
        return model.qrEnabled
            ? '已启用：报名通过后展示报名码，核销后状态变为“已参加”。'
            : '未启用：报名详情不展示报名码，展商仍可在报名管理中手动调整状态。';
    }

    /** 就地刷新「报名方式」一行，避免重建页面丢掉未保存的表单内容。 */
    function refreshModeRow() {
        replace(modeTag, statusTagFor(model.status));
        replace(modeSummary, el('span', { class: 'row-meta fill', text: hintFor(model.status) }));
    }

    function statusTagFor(status) {
        const tone = status === '需审核' ? 'pending' : (status === '无需审核' ? 'ok' : 'info');
        return el('span', { class: 'status-tag', dataset: { tone }, text: status });
    }

    /** 报名方式面板：与展商后台原来的底部面板一致，只是入口搬到了本页的设置栏。 */
    function openModeSheet() {
        const sheet = openSheet({
            title: '设置报名方式',
            content: [
                el('p', { class: 'row-meta', text: `当前：${model.status}` }),
                el('div', { class: 'list', 'data-gap': 'sm' }, MODES.map((mode) => el('button', {
                    class: 'row-card',
                    type: 'button',
                    dataset: { pressable: 'true' },
                    onclick: async () => {
                        sheet.close();
                        if (mode.value === model.status) {
                            return;
                        }
                        model.status = mode.value;
                        refreshModeRow();
                        if (isCreate) {
                            return;
                        }
                        // 已保存的展会立即写库，回到卡片时状态就是最新的。
                        await saveStatusOnly();
                    },
                }, [
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: mode.label }),
                        el('span', { class: 'row-meta', text: hintFor(mode.value) }),
                    ]),
                    mode.value === model.status
                        ? el('span', { class: 'status-tag', dataset: { tone: 'pending' }, text: '当前' })
                        : null,
                ]))),
            ],
            actions: [{ label: '取消', onClick: (close) => close() }],
        });
    }

    /** 只提交报名方式（状态），保存后停留在当前页，不打断展商的编辑。 */
    async function saveStatusOnly() {
        try {
            const saved = await call('exhibitions.save', buildPayload());
            if (!saved?.ok) {
                toast(saved?.error || '报名方式保存失败', 'error');
                return;
            }
            toast('报名方式已更新', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function askDelete() {
        confirmSheet({
            title: '删除展会',
            message: `删除「${model.title || '该展会'}」后，展会信息与报名收集项都会移除，且无法恢复。`,
            confirmLabel: '删除',
            tone: 'danger',
            onConfirm: async () => {
                try {
                    const ok = await call('exhibitions.delete', { id: model.id });
                    toast(ok ? '展会已删除' : '删除失败', ok ? 'success' : 'error');
                    if (ok) {
                        context.navigate('exhibitor', {}, { replace: true });
                    }
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }

    function renderFields() {
        replace(fieldsHost, fields.map((item, index) => {
            const isChoice = item.type === '单选' || item.type === '多选';
            const optionsHost = el('div', { class: 'stack', 'data-gap': 'sm' });

            const renderOptions = () => {
                replace(optionsHost, [
                    el('span', { class: 'field-hint', text: item.type === '单选' ? '单选选项' : '多选选项' }),
                    ...item.options.map((option, optionIndex) => el('div', { class: 'option-row' }, [
                        textInput(`field-${index}-option-${optionIndex}`, 'text', option,
                            `选项 ${optionIndex + 1}`, (value) => {
                                item.options[optionIndex] = value;
                            }),
                        el('button', {
                            class: 'icon-button option-remove',
                            type: 'button',
                            'aria-label': `删除选项 ${optionIndex + 1}`,
                            onclick: () => {
                                item.options.splice(optionIndex, 1);
                                renderOptions();
                            },
                        }, [icon('trash', 'icon icon-sm')]),
                    ])),
                    el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        style: { minHeight: '44px', fontSize: 'var(--fs-label)' },
                        onclick: () => {
                            item.options.push('');
                            renderOptions();
                        },
                    }, ['添加选项']),
                ]);
            };
            if (isChoice) {
                renderOptions();
            }

            return el('div', { class: 'card', 'data-tone': 'fill' }, [
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
                    }, [icon('trash', 'icon icon-sm')]),
                ]),
                textInput(`field-title-${index}`, 'text', item.title, '字段标题', (value) => {
                    item.title = value;
                }, limit('fieldTitle', 30)),
                el('div', { class: 'grid-cols-2' }, [
                    selectInput(`field-type-${index}`, ['文本', '单选', '多选'], item.type, (value) => {
                        item.type = value;
                        if (value !== '文本' && item.options.length === 0) {
                            item.options.push('', '');
                        }
                        renderFields();
                    }),
                    selectInput(`field-req-${index}`, ['选填', '必填'], item.required ? '必填' : '选填', (value) => {
                        item.required = value === '必填';
                    }),
                ]),
                isChoice ? optionsHost : null,
            ]);
        }));
    }

    /** 组装保存用的 payload，「保存」与「报名方式」即时写库共用同一份结构。 */
    function buildPayload() {
        return {
            id: model.id,
            title: titleInput.value.trim(),
            venue: venueInput.value.trim(),
            date: dateInput.value,
            day: Number(dateInput.value.slice(8, 10)) || 0,
            time: timeInput.value.trim(),
            status: model.status,
            category: categoryInput.value.trim(),
            description: model.description,
            descriptionFormat: 'md',
            imageUri: model.imageUri,
            registrationStart: startInput.value,
            registrationEnd: endInput.value,
            qrEnabled: model.qrEnabled,
            // 空选项不下发，避免保存出无意义的选项条目。
            fields: fields
                .filter((item) => item.title.trim() !== '')
                .map((item) => ({
                    title: item.title.trim(),
                    type: item.type,
                    required: item.required,
                    options: item.type === '文本'
                        ? []
                        : item.options.map((option) => option.trim()).filter(Boolean),
                })),
        };
    }

    async function submit() {
        errorBox.hidden = true;
        const result = validateAll(validators);
        if (!result.ok) {
            return fail(result.message, result.validator.control);
        }
        const fieldTitleError = validateFieldTitles();
        if (fieldTitleError) {
            return fail(fieldTitleError);
        }
        saveButton.disabled = true;
        try {
            const saved = await call('exhibitions.save', buildPayload());
            if (!saved?.ok) {
                saveButton.disabled = false;
                return fail(saved?.error || '保存失败');
            }
            model.id = saved.exhibition.id;
            model.description = saved.exhibition.description || model.description;
            model.imageUri = saved.exhibition.imageUri || model.imageUri;
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

    function textInput(id, type, value, placeholder, onInput, maxLength) {
        const control = el('input', { class: 'input', id, type, placeholder, value: value || '' });
        if (maxLength > 0) {
            control.setAttribute('maxlength', String(maxLength));
        }
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

/** 选项来源兼容字符串（逗号分隔）与数组，模型内统一为数组。 */
function normalizeOptions(options) {
    if (Array.isArray(options)) {
        return options.map((item) => String(item));
    }
    return String(options || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
