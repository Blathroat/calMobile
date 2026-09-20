import { t } from '../core/strings.js';
/**
 * 屏幕 12 · 展会简介（Markdown 编辑）
 * 线框：newUI/remaining-ui.html #screen-rich-editor
 *
 * 编辑器使用成熟的 EasyMDE（已随包内置在 assets/web/vendor/easymde，MIT），
 * 不自行实现富文本；支持直接粘贴 Markdown 文本、实时预览与插图。
 * 保存的是 Markdown 源码，详情页按 Markdown 渲染。
 *
 * 取数走 core/loadable.js：展会详情命中缓存时直接继续挂载编辑器，不先闪骨架屏。
 */

import { call, state } from '../core/bridge.js';
import { exhibitions } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { scaffold, topAction } from '../core/router.js';
import { icon, loadErrorBlock, loadingBlock, notFoundBlock, openSheet, pageFoot, toast } from '../ui/components.js';
import { htmlToMarkdown, markdownSummary, ensureMarked } from '../core/markdown.js';
import { allowedFormats, uploadCountLimit, uploadSizeLimitMb, uploadSizeError } from '../core/validate.js';
import { el, append, replace } from '../core/dom.js';

export async function richEditorPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = pageFoot();
    const saveButton = topAction('save', t('s_1kqdxz5'), () => save());

    scaffold({
        title: t('s_28v8q'),
        backTo: 'exhibition-form',
        bodyProps: { 'data-gap': 'tight' },
        actions: [saveButton],
        foot,
        children: [host],
    });

    let exhibition = null;
    // 展会详情通常已经在缓存里（刚在编辑页取过）：命中时同步返回，不再先闪骨架屏。
    const data = await loadInto(host, {
        read: exhibitions.get,
        params: context.params.id,
        rows: 3,
        errorTitle: t('s_kvpltc'),
        // 编辑器要等内置库加载完才挂载，这一步只把数据记下来，绘制统一交给 renderChrome。
        render: (value) => {
            exhibition = value?.exhibition || null;
        },
        // 取不到详情就没法继续编辑：重试要重跑整个页面，而不是只重跑这一次取数。
        onError: (error) => {
            replace(host, loadErrorBlock({
                title: t('s_kvpltc'),
                description: error.message,
                onRetry: () => context.refresh(),
            }));
        },
    });
    // loadInto 不抛异常：失败时返回 undefined，此时错误块已经就位，页面必须停下。
    if (data === undefined) {
        return;
    }
    if (!data?.found) {
        replace(host, notFoundBlock({
            title: t('s_1vim1qp'),
            description: data?.error || t('s_1q6xpub'),
            backLabel: t('s_dn4ida'),
            onBack: () => context.navigate('exhibitor'),
        }));
        return;
    }

    replace(host, loadingBlock(4));
    let editor = null;
    try {
        await ensureVendorLoaded();
        editor = mountEditor(host);
    } catch (error) {
        mountPlainFallback(error);
        return;
    }

    renderChrome(editor);

    // ── 编辑器挂载 ─────────────────────────────────────────────────

    /** EasyMDE 是全局脚本，只加载一次；失败时抛出以便回退到纯文本编辑。 */
    async function ensureVendorLoaded() {
        if (window.EasyMDE) {
            return;
        }
        // 详情页可能已经按需加载过同一个文件，这里复用 core/markdown 的加载器。
        await ensureMarked();
        if (!window.EasyMDE) {
            throw new Error(t('s_1jyec01'));
        }
    }

    function initialMarkdown() {
        if (exhibition.descriptionFormat === 'html') {
            return htmlToMarkdown(exhibition.description);
        }
        return String(exhibition.description || '');
    }

    function mountEditor(target) {
        // EasyMDE 会就地替换传入的 textarea，并且 instance.element 指向 textarea 本身，
        // 因此额外包一层容器用于页面渲染，避免把编辑器从 .EasyMDEContainer 中摘出来。
        const container = el('div', { class: 'markdown-editor' });
        const textarea = el('textarea', { id: 'rich-markdown' });
        append(container, textarea);
        append(target, container);

        const instance = new window.EasyMDE({
            element: textarea,
            initialValue: initialMarkdown(),
            autofocus: false,
            spellChecker: false,
            status: ['lines', 'words'],
            minHeight: '260px',
            placeholder: t('s_1jvhwb1'),
            // 使用项目内的细线 SVG，避免依赖外部图标字体。
            toolbar: toolbarButtons(),
        });
        target.dataset.mode = 'easymde';

        // 粘贴板里是 Markdown 时直接写入编辑器，保持排版不丢。
        instance.codemirror.on('paste', (_, event) => {
            const text = event.clipboardData?.getData('text/plain') || '';
            if (text && /(^|\n)\s*(#{1,6}\s|[-*+]\s|>\s|```)/.test(text)) {
                instance.value(text);
                toast(t('s_1n2azlj'), 'success');
            }
        });
        container.__instance = instance;
        // 页面渲染时以自定义容器为准，避免把编辑器从 .EasyMDEContainer 中摘出来。
        instance.element = container;
        return instance;
    }

    /** 兜底：EasyMDE 不可用时仍能编辑 Markdown 文本，并说明降级原因。 */
    function mountPlainFallback(error) {
        const area = el('textarea', { class: 'textarea', id: 'rich-markdown', rows: 12 });
        area.value = initialMarkdown();
        const wrapper = el('div', { class: 'stack' }, [
            el('div', { class: 'notice', 'data-tone': 'accent' }, [
                el('strong', { text: t('s_bmmuuy') }),
                el('span', { text: `${error?.message || t('s_1pt94qt')}；内容仍以 Markdown 保存。` }),
            ]),
            area,
        ]);
        editor = {
            value: (next) => {
                if (typeof next === 'string') {
                    area.value = next;
                }
                return area.value;
            },
        };
        renderChrome(editor, wrapper);
    }
    /**
     * 工具栏图标：与项目其它图标一致的细线 SVG。
     * 动作优先使用 EasyMDE 提供的静态方法，缺失时退化为插入固定语法。
     */
    function toolbarButtons() {
        const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
        const builtin = (method, fallbackPrefix, fallbackSuffix) => () => {
            if (typeof window.EasyMDE[method] === 'function') {
                window.EasyMDE[method](editor);
                return;
            }
            surround(fallbackPrefix, fallbackSuffix);
        };
        return [
            {
                name: 'heading',
                action: () => surround('## ', ''),
                className: 'mde-heading',
                title: t('s_4okt0a'),
                icon: svg('heading'),
            },
            {
                name: 'bold',
                action: builtin('toggleBold', '**', '**'),
                className: 'mde-bold',
                title: t('s_1e57pa0'),
                icon: svg('bold'),
            },
            {
                name: 'italic',
                action: builtin('toggleItalic', '*', '*'),
                className: 'mde-italic',
                title: t('s_69k40o'),
                icon: svg('italic'),
            },
            {
                name: 'quote',
                action: builtin('toggleBlockquote', '> ', ''),
                className: 'mde-quote',
                title: t('s_1wogqko'),
                icon: svg('quote'),
            },
            {
                name: 'unordered-list',
                action: builtin('toggleUnorderedList', '- ', ''),
                className: 'mde-list',
                title: t('s_z3ic32'),
                icon: svg('list'),
            },
            {
                name: 'ordered-list',
                action: builtin('toggleOrderedList', '1. ', ''),
                className: 'mde-ordered',
                title: t('s_1l65wvf'),
                icon: svg('ordered'),
            },
            '|',
            {
                name: 'link',
                action: () => {
                    if (typeof window.EasyMDE.drawLink === 'function') {
                        window.EasyMDE.drawLink(editor);
                        return;
                    }
                    surround('[', '](https://)');
                },
                className: 'mde-link',
                title: t('s_1gqx0u5'),
                icon: svg('link'),
            },
            { name: 'image', action: () => insertImage(), className: 'mde-image', title: t('s_1w5fs53'), icon: svg('image') },
            { name: 'video', action: () => insertVideo(), className: 'mde-video', title: t('s_1aj4gvd'), icon: svg('video') },
            {
                name: 'table',
                action: () => {
                    if (typeof window.EasyMDE.drawTable === 'function') {
                        window.EasyMDE.drawTable(editor);
                        return;
                    }
                    appendText(t('s_spr4u2'));
                },
                className: 'mde-table',
                title: t('s_1kll7do'),
                icon: svg('table'),
            },
            '|',
            {
                name: 'preview',
                action: () => {
                    if (typeof window.EasyMDE.togglePreview === 'function') {
                        window.EasyMDE.togglePreview(editor);
                        return;
                    }
                    toast(t('s_24nfoo'));
                },
                className: 'mde-preview',
                title: t('s_k2jp4x'),
                icon: svg('eye'),
            },
            { name: 'paste', action: () => openPasteSheet(), className: 'mde-paste', title: t('s_7zi2sm'), icon: svg('paste') },
            { name: 'clear', action: () => clearAll(), className: 'mde-clear', title: t('s_14ggq2g'), icon: svg('trash') },
        ];
    }

    /** 在光标处包裹选中文本（无选中时插入占位文本）。 */
    function surround(prefix, suffix) {
        editor.value(`${editor.value().trimEnd()}${prefix}文本${suffix}`);
    }

    function appendText(text) {
        editor.value(`${editor.value().trimEnd()}${text}`);
    }

    // ── 页面结构 ───────────────────────────────────────────────────

    function renderChrome(instance, explicitNode) {
        const editorNode = explicitNode || instance.element;
        const media = state.media || {};
        replace(host, [
            el('div', { class: 'card', 'data-tone': 'fill' }, [
                el('strong', { text: exhibition.title }),
                el('span', { class: 'row-meta', text: t('s_9dpkko') }),
            ]),
            editorNode,
            el('div', { class: 'row', 'data-gap': 'md' }, [
                ghostButton(t('s_7zi2sm'), () => openPasteSheet(), 'paste'),
                ghostButton(t('s_1w5fs53'), () => insertImage(), 'image'),
                ghostButton(t('s_1aj4gvd'), () => insertVideo(), 'video'),
            ]),
            el('p', { class: 'field-hint', text: mediaLimitHint(media) }),
        ]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', { class: 'cta', type: 'button', onclick: () => save() }, [t('s_1kqdxz5')]),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: t('s_4l0yq7') }),
        ]));
    }

    /**
     * 媒体限制说明：数量与大小上限都来自「管理-设置」，图片与视频各说一遍。
     * <p>
     * 视频除了个数还有大小上限（`state.media.videoSizeMb`），只说个数会让用户
     * 以为视频可以无限大。`videoCount` 为 0 是合法配置（表示禁用），因此数量上限
     * 统一走 {@link uploadCountLimit}，不能用 `|| 默认值` 把 0 换成默认值。
     */
    function mediaLimitHint(media) {
        const imageCount = media.imageCount || 8;
        const imageSize = media.imageSizeMb || 10;
        const videoCount = uploadCountLimit('video');
        const videoSize = uploadSizeLimitMb('video');
        return `媒体数量与大小受服务器设置限制：图片 ${imageCount} 张 / 单张 ${imageSize} MB，`
            + `视频 ${videoCount} 个 / 单个不超过 ${videoSize} MB；`
            + t('s_vkgi23');
    }

    function ghostButton(label, onClick, iconName) {
        return el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: onClick,
        }, [icon(iconName, 'icon icon-sm'), label]);
    }

    // ── 操作 ───────────────────────────────────────────────────────

    /** 直接粘贴 Markdown：整段替换或追加到末尾。 */
    function openPasteSheet() {
        const area = el('textarea', { class: 'textarea', id: 'paste-markdown', rows: 8, placeholder: t('s_3ppp7q') });
        openSheet({
            title: t('s_7zi2sm'),
            size: 'full',
            content: [
                el('p', { class: 'row-meta', text: t('s_wo4aqm') }),
                area,
            ],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_booftk'),
                    onClick: (close) => {
                        applyPaste(area.value, false);
                        close();
                    },
                },
                {
                    label: t('s_ekbz2c'),
                    variant: 'primary',
                    onClick: (close) => {
                        applyPaste(area.value, true);
                        close();
                    },
                },
            ],
        });
    }

    function applyPaste(text, replaceAll) {
        const value = String(text || '').trim();
        if (!value) {
            toast(t('s_ijdxmv'), 'error');
            return;
        }
        const current = editor.value();
        editor.value(replaceAll || !current.trim() ? value : `${current.trimEnd()}\n\n${value}`);
        toast(replaceAll ? t('s_17pstxc') : t('s_1oas91y'), 'success');
    }

    /**
     * 插入图片：交给原生落盘后只写入短 URL。
     * <p>
     * 早期版本把图片写成内联 base64，长简介因此体积巨大、编辑器载入缓慢；
     * 现在统一走 {@code media.import}，Markdown 里只保留
     * {@code ![展会图片](https://appassets.androidplatform.net/media/xxx.jpg)}。
     */
    async function insertImage() {
        const media = state.media || {};
        const limit = media.imageCount || 8;
        const currentCount = (editor.value().match(/!\[[^\]]*]\([^)]*\)/g) || []).length;
        if (currentCount >= limit) {
            toast(`图片数量已达上限（${limit} 张）`, 'error');
            return;
        }
        const formats = allowedFormats('image');
        try {
            const result = await call('media.import', { kind: 'image' });
            if (!result?.url) {
                toast(t('s_1dc9o49'), 'error');
                return;
            }
            const markdown = `\n\n![展会图片](${result.url})\n\n`;
            editor.value(`${editor.value().trimEnd()}${markdown}`);
            const size = formatBytes(result.bytes);
            toast(result.compressed ? `图片已压缩为 ${size} 并插入` : `图片已插入（${size}）`, 'success');
        } catch (error) {
            if (String(error.message).includes(t('s_1589w37'))) {
                return;
            }
            toast(error.message || `请选择 ${formatsHint(formats)} 格式的图片`, 'error');
        }
    }

    function formatsHint(formats) {
        return formats.length > 0 ? formats.map((item) => `.${item}`).join('/') : t('s_1ylglbm');
    }

    /**
     * 插入视频：与图片同一条路（原生落盘 → 只写入短 URL），区别只在写进正文的形式。
     * <p>
     * Markdown 里直接写 HTML 的 video 标签（src 指向原生落盘后的短 URL）：
     * `core/sanitize.js` 的白名单允许 `<video>` 与 `src` / `controls` 等属性，
     * 详情页与编辑器预览因此都能保留并播放它。
     *
     * 取消（原生抛「取消」）与图片一致：静默返回，不弹红色错误。
     */
    async function insertVideo() {
        const limit = uploadCountLimit('video');
        const currentCount = (editor.value().match(/<video\b/gi) || []).length;
        if (currentCount >= limit) {
            toast(`视频数量已达上限（${limit} 个）`, 'error');
            return;
        }
        const formats = allowedFormats('video');
        try {
            const result = await call('media.import', { kind: 'video' });
            if (!result?.url) {
                toast(t('s_s0oos7'), 'error');
                return;
            }
            // 视频不像图片那样会被原生压缩：超过服务器设置的上限时不要插进正文。
            const oversized = uploadSizeError('video', result.bytes);
            if (oversized) {
                toast(oversized, 'error');
                return;
            }
            insertAtCursor(`\n\n<video controls src="${result.url}"></video>\n\n`);
            toast(`视频已插入（${formatBytes(result.bytes)}）`, 'success');
        } catch (error) {
            if (String(error.message).includes(t('s_1589w37'))) {
                return;
            }
            toast(error.message || `请选择 ${formatsHint(formats)} 格式的视频`, 'error');
        }
    }

    /**
     * 把一段 Markdown / HTML 插到当前光标处。
     * <p>
     * EasyMDE 挂着 CodeMirror 时用 `replaceSelection`（有选中内容就替换它）；
     * 纯文本兜底编辑器没有 CodeMirror，退化为追加到末尾（与插图一致）。
     */
    function insertAtCursor(text) {
        const codemirror = editor?.codemirror;
        if (codemirror && typeof codemirror.replaceSelection === 'function') {
            codemirror.replaceSelection(text);
            return;
        }
        editor.value(`${editor.value().trimEnd()}${text}`);
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 * 1024) {
            return `${(value / 1024 / 1024).toFixed(1)} MB`;
        }
        if (value >= 1024) {
            return `${Math.round(value / 1024)} KB`;
        }
        return `${value} B`;
    }

    function clearAll() {
        if (!editor.value().trim()) {
            return;
        }
        openSheet({
            title: t('s_kjpxv'),
            content: [el('p', { class: 'muted', text: t('s_1kokqyk') })],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_9mbwb2'),
                    onClick: (close) => {
                        editor.value('');
                        close();
                        toast(t('s_lp789j'));
                    },
                },
            ],
        });
    }

    async function save() {
        const markdown = String(editor.value() || '').trim();
        saveButton.disabled = true;
        try {
            const result = await exhibitions.save({
                id: exhibition.id,
                title: exhibition.title,
                venue: exhibition.venue,
                time: exhibition.time,
                status: exhibition.status,
                category: exhibition.category,
                date: exhibition.date,
                description: markdown,
                descriptionFormat: 'md',
                registrationStart: exhibition.registrationStart,
                registrationEnd: exhibition.registrationEnd,
            });
            if (!result?.ok) {
                toast(result?.error || t('s_1q9u8le'), 'error');
                return;
            }
            exhibition = result.exhibition;
            toast(markdown ? `简介已保存（${markdownSummary(markdown, 20)}）` : t('s_1lylgf9'), 'success');
            context.navigate('exhibition-form', { id: exhibition.id }, { replace: true });
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            saveButton.disabled = false;
        }
    }
}

/** 工具栏图标：与项目其它图标一致的细线风格。 */
const PATHS = {
    heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
    bold: '<path d="M8 5h5.5a3.5 3.5 0 0 1 0 7H8Zm0 7h6.2a3.5 3.5 0 0 1 0 7H8Z"/>',
    italic: '<path d="M15 5h-5M14 19H9M13.5 5 10.5 19"/>',
    quote: '<path d="M7 7h4v4a4 4 0 0 1-4 4M15 7h4v4a4 4 0 0 1-4 4"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
    ordered: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20M4 5.5h1.6v3M4 11.4c0-.6 1.6-.8 1.6.2 0 .8-1.6 1.4-1.6 2.4h1.8M4 16.6h1.4c.6 0 .8 1.2-.3 1.3.9.1 1 1.4-.1 1.4H4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.6 6.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
    video: '<rect x="3.5" y="6" width="12" height="12" rx="2"/><path d="m15.5 12 5-3v6Z"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    paste: '<rect x="6" y="4.5" width="12" height="15" rx="2"/><path d="M9.5 4.5V3.5h5v1M9 10h6M9 13.5h6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M7 7l1 12.2h8L17 7"/>',
};
