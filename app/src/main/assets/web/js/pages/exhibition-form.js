import { t } from '../core/strings.js';
/**
 * 屏幕 11 · 展会编辑（新建 / 编辑）
 * 线框：newUI/remaining-ui.html #screen-exhibition-form
 * 业务：ExhibitionManager.add/update + ExhibitionConfiguration（日期、报名起止、收集项）。
 *
 * 展商后台卡片上的“报名方式”“编辑简介”“删除展会”都收进本页的「报名与简介设置」栏，
 * 展商从这里统一维护展会配置，卡片只需要两个入口。
 *
 * 取数走 core/loadable.js：命中缓存时同步出内容，因此从展商后台点进来不会先闪骨架屏。
 */

import { call } from '../core/bridge.js';
import { exhibitions } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { scaffold, topAction } from '../core/router.js';
import { confirmSheet, icon, notFoundBlock, openSheet, pageFoot, switchRow, toast } from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';
import { EXHIBITION_STATUS, REGISTRATION_MODES, modeHint as hintFor, statusTone } from '../core/status.js';
import { markdownSummary } from '../core/markdown.js';
import { fieldValidator, validateAll, limit, allowedFormats, PATTERNS } from '../core/validate.js';

const MODES = REGISTRATION_MODES.map((value) => ({ value, label: value }));

export async function exhibitionFormPage(context) {
    const isCreate = !context.params.id;
    const host = el('div', { class: 'stack' });
    const foot = pageFoot();
    const saveButton = topAction('save', isCreate ? t('s_gya40f') : t('s_10q6dxb'), () => submit());

    scaffold({
        title: isCreate ? t('s_p9fllo') : t('s_eutzzb'),
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
        status: EXHIBITION_STATUS.REVIEW_REQUIRED,
        category: '',
        description: '',
        imageUri: '',
        registrationStart: '',
        registrationEnd: '',
        qrEnabled: false,
    };
    let fields = [];

    // 表单只建一次：loadInto 可能先画缓存、再画远端数据，第二帧直接跳过，
    // 否则重建会把用户已经输入的内容冲掉。
    let built = false;
    // 控件与校验器都在 buildForm() 里创建，所以先声明、后赋值。
    let titleInput, venueInput, dateInput, timeInput, startInput, endInput, categoryInput;
    let errorBox, fieldsHost, descriptionPreview, descriptionButton, modeTag, modeSummary;
    let coverPreview, coverHint;
    let validators = [];

    if (isCreate) {
        // 新建展会没有要取的数据，直接出空表单。
        buildForm();
        return;
    }

    await loadInto(host, {
        read: exhibitions.get,
        params: context.params.id,
        rows: 4,
        errorTitle: t('s_kvpltc'),
        render: (data) => {
            if (!data?.found) {
                replace(host, notFoundBlock({
                    title: t('s_1vim1qp'),
                    description: data?.error || t('s_1qfu0ss'),
                    backLabel: t('s_dn4ida'),
                    onBack: () => context.navigate('exhibitor'),
                }));
                return;
            }
            if (built) {
                return;
            }
            built = true;
            const item = data.exhibition;
            Object.assign(model, {
                id: item.id,
                title: item.title,
                venue: item.venue,
                date: item.date,
                time: item.time,
                status: MODES.some((mode) => mode.value === item.status) ? item.status : EXHIBITION_STATUS.REVIEW_REQUIRED,
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
            buildForm();
        },
    });

    // ── 封面与「报名方式」的渲染辅助 ───────────────────────────────

    function formatsHint() {
        const list = allowedFormats('image');
        return list.length > 0 ? list.map((item) => `.${item}`).join('/') : t('s_1qnyx3k');
    }

    function renderCover() {
        replace(coverPreview, [
            model.imageUri
                ? el('div', { class: 'hero ph-img hero-compact' }, [el('img', { src: model.imageUri, alt: t('s_63jsvx') })])
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
                    }, [t('s_eab5ax')])
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
        }, [model.imageUri ? t('s_xocxb0') : t('s_6piprk')]);
        return button;
    }

    /** 封面直接落盘成短 URL，避免把图片塞进简介或展会记录。 */
    async function pickCover(button) {
        button.disabled = true;
        try {
            const stored = await call('media.import', { kind: 'image' });
            if (!stored?.url) {
                toast(t('s_1dc9o49'), 'error');
                return;
            }
            model.imageUri = stored.url;
            renderCover();
            toast(stored.compressed ? t('s_1bbs6qg') : t('s_1ckoagi'), 'success');
        } catch (error) {
            if (String(error.message).includes(t('s_1589w37'))) {
                return;
            }
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    /**
     * 首次绘制时才建表单：控件、校验器与整页内容都只创建一次。
     *
     * 之所以不放在页面加载时直接建，是因为 loadInto 可能画两帧（先缓存、后远端数据），
     * 有了 built 这道闸，第二帧不会再走这里，输入框里的内容因此只被写过一次。
     */
    function buildForm() {
        // ── 表单控件 ───────────────────────────────────────────────

        titleInput = textInput('form-title', 'text', model.title, t('s_giboid'));
        venueInput = textInput('form-venue', 'text', model.venue, t('s_vih0tf'));
        dateInput = textInput('form-date', 'date', model.date);
        timeInput = textInput('form-time', 'text', model.time, '09:00-17:00');
        startInput = textInput('form-reg-start', 'date', model.registrationStart);
        endInput = textInput('form-reg-end', 'date', model.registrationEnd);
        categoryInput = textInput('form-category', 'text', model.category, '例如：智能制造 / 工业自动化');
        errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
        fieldsHost = el('div', { class: 'stack', 'data-gap': 'sm' });

        descriptionPreview = el('p', { class: 'row-meta' });
        descriptionButton = el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)' },
            disabled: isCreate ? true : null,
            onclick: () => context.navigate('rich-editor', { id: model.id }),
        }, [isCreate ? t('s_1wz04v2') : t('s_21ce2x')]);

        // 「报名方式」一行的两个可变节点：就地更新，避免重建页面丢掉未保存的输入。
        modeTag = el('span', [statusTagFor(model.status)]);
        modeSummary = el('span', { class: 'fill' }, [
            el('span', { class: 'row-meta', text: hintFor(model.status) }),
        ]);

        coverPreview = el('div', { class: 'cover-preview' });
        coverHint = el('p', {
            class: 'field-hint',
            text: `建议使用 1080×1920（9:16）的竖版图片，当前允许 ${formatsHint()}。`,
        });

        // ── 前端校验：上限来自「管理-设置」的服务器设置 ────────────

        validators = [
            fieldValidator({
                control: titleInput,
                label: t('s_1co82cb'),
                required: true,
                max: limit('exhibitionTitle', 60),
            }),
            fieldValidator({
                control: venueInput,
                label: t('s_1tlfy5l'),
                required: true,
                max: limit('exhibitionVenue', 60),
            }),
            fieldValidator({
                control: dateInput,
                label: t('s_s2nfay'),
                required: true,
                pattern: PATTERNS.date,
                patternMessage: t('s_1appv4n'),
            }),
            fieldValidator({
                control: timeInput,
                label: t('s_kgtsw4'),
                max: 20,
                pattern: PATTERNS.timeRange,
                patternMessage: t('s_1q49p4s'),
            }),
            fieldValidator({
                control: endInput,
                label: t('s_cbxrmr'),
                custom: () => {
                    const start = startInput.value;
                    const end = endInput.value;
                    if (start && end && end < start) {
                        return t('s_1gcmqh3');
                    }
                    return '';
                },
            }),
            fieldValidator({
                control: categoryInput,
                label: t('s_9xu72h'),
                max: limit('category', 20),
                pattern: PATTERNS.category,
                patternMessage: t('s_ariomv'),
            }),
            fieldValidator({
                control: startInput,
                label: t('s_k1e25y'),
                custom: () => {
                    if (startInput.value && dateInput.value && startInput.value > dateInput.value) {
                        return t('s_h8z5hw');
                    }
                    return '';
                },
            }),
        ];

        render();
    }

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
                field(t('s_1co82cb'), titleInput, true),
                field(t('s_25fwki'), venueInput, true),
                el('div', { class: 'grid-cols-2' }, [
                    field(t('s_s2nfay'), dateInput, true),
                    field(t('s_kgtsw4'), timeInput),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    field(t('s_4o8ie2'), startInput),
                    field(t('s_60i0xr'), endInput, false, t('s_165tsl5')),
                ]),
                field(t('s_9xu72h'), categoryInput, false, t('s_1bem6b7')),
                errorBox,
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: t('s_63jsvx') }),
                    el('span', { class: 'pill', text: '1080 × 1920' }),
                ]),
                coverPreview,
                coverHint,
            ]),
            settingsCard(),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: t('s_s8p5nm') }),
                    el('span', { class: 'pill', text: `${fields.length} 项` }),
                ]),
                el('p', { class: 'field-hint', text: t('s_3q8q3k') }),
                fieldsHost,
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    onclick: () => {
                        fields.push({ title: '', type: '文本', required: false, options: [] });
                        renderFields();
                    },
                }, [t('s_1t5x3h2')]),
            ]),
        ]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => submit(),
            }, [isCreate ? t('s_gya40f') : t('s_10q6dxb')]),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: t('s_167n8sn') }),
        ]));
    }

    function updateDescriptionPreview() {
        descriptionPreview.textContent = model.description
            ? (markdownSummary(model.description, 70) || t('s_1fpy22o'))
            : t('s_12ibypn');
    }

    /**
     * 报名与简介设置：展商后台卡片上的“报名方式”“编辑简介”“删除展会”都收在这里。
     * 新建展会时先保存，保存后按钮自动切换成可用状态。
     */
    function settingsCard() {
        const qrSwitch = switchRow({
            id: 'form-qr-enabled',
            label: t('s_1birmm3'),
            description: t('s_2ccwmm'),
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
            el('span', { class: 'section-label', text: t('s_1ylv0q2') }),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('strong', { text: t('s_1vv5l4v') }),
                    el('button', {
                        class: 'pill',
                        type: 'button',
                        text: t('s_13fr7ko'),
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
                    el('strong', { text: t('s_2x5dgj') }),
                    descriptionButton,
                ]),
                descriptionPreview,
            ]),
            el('hr', { class: 'divider' }),
            qrSwitch,
            qrHint,
            el('hr', { class: 'divider' }),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: t('s_qtyy0e') }),
                el('button', {
                    class: 'cta danger',
                    type: 'button',
                    disabled: isCreate ? true : null,
                    onclick: () => askDelete(),
                }, [isCreate ? t('s_mj5xsg') : t('s_1u7mlaq')]),
                el('p', {
                    class: 'field-hint',
                    text: isCreate
                        ? t('s_utjuhy')
                        : t('s_175wm9u'),
                }),
            ]),
        ]);
    }

    function qrHintText() {
        return model.qrEnabled
            ? t('s_mu5yl5')
            : t('s_3xcdlm');
    }

    /** 就地刷新「报名方式」一行，避免重建页面丢掉未保存的表单内容。 */
    function refreshModeRow() {
        replace(modeTag, statusTagFor(model.status));
        replace(modeSummary, el('span', { class: 'row-meta fill', text: hintFor(model.status) }));
    }

    function statusTagFor(status) {
        const tone = statusTone(status);
        return el('span', { class: 'status-tag', dataset: { tone }, text: status });
    }

    /** 报名方式面板：与展商后台原来的底部面板一致，只是入口搬到了本页的设置栏。 */
    function openModeSheet() {
        const sheet = openSheet({
            title: t('s_1tv04uf'),
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
                        ? el('span', { class: 'status-tag', dataset: { tone: 'pending' }, text: t('s_1h1tn0d') })
                        : null,
                ]))),
            ],
            actions: [{ label: t('s_1589w37'), onClick: (close) => close() }],
        });
    }

    /** 只提交报名方式（状态），保存后停留在当前页，不打断展商的编辑。 */
    async function saveStatusOnly() {
        try {
            const saved = await exhibitions.save(buildPayload());
            if (!saved?.ok) {
                toast(saved?.error || t('s_1n4563g'), 'error');
                return;
            }
            toast(t('s_i0as17'), 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function askDelete() {
        confirmSheet({
            title: t('s_1u7mlaq'),
            message: `删除「${model.title || t('s_1yjopwv')}」后，展会信息与报名收集项都会移除，且无法恢复。`,
            confirmLabel: t('s_1t2vi4h'),
            tone: 'danger',
            onConfirm: async () => {
                try {
                    // 写接口统一返回 { ok, error }，只判断响应本身会把失败当成成功。
                    const result = await exhibitions.remove(model.id);
                    const ok = result?.ok === true;
                    toast(ok ? t('s_1jj834o') : (result?.error || t('s_1ijrr73')), ok ? 'success' : 'error');
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
                    el('span', { class: 'field-hint', text: item.type === '单选' ? t('s_1y8221p') : t('s_dpy0pe') }),
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
                    }, [t('s_1nl5fxw')]),
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
                        'aria-label': t('s_qa4u6r'),
                        onclick: () => {
                            fields.splice(index, 1);
                            renderFields();
                        },
                    }, [icon('trash', 'icon icon-sm')]),
                ]),
                textInput(`field-title-${index}`, 'text', item.title, t('s_1u3w62u'), (value) => {
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
            const saved = await exhibitions.save(buildPayload());
            if (!saved?.ok) {
                saveButton.disabled = false;
                return fail(saved?.error || t('s_1q9u8le'));
            }
            model.id = saved.exhibition.id;
            model.description = saved.exhibition.description || model.description;
            model.imageUri = saved.exhibition.imageUri || model.imageUri;
            toast(isCreate ? t('s_opaqad') : t('s_1sfkhdl'), 'success');
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
