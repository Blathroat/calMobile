/**
 * 屏幕 12 · 富文本编辑（展会简介与媒体）
 * 线框：newUI/remaining-ui.html #screen-rich-editor
 * 业务：保存到 ExhibitionManager.update 的 description 字段；媒体数量与大小遵循系统设置。
 */

import { call, state } from '../core/bridge.js';
import { scaffold, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, toast } from '../ui/components.js';
import { sanitizeHtml, isBlankHtml } from '../core/sanitize.js';
import { el, append, replace } from '../core/dom.js';

export async function richEditorPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });
    const saveButton = topAction('save', '保存简介', () => save());

    scaffold({
        title: '编辑展会简介',
        backTo: 'exhibition-form',
        bodyProps: { 'data-gap': 'tight' },
        actions: [saveButton],
        foot,
        children: [host],
    });

    let exhibition = null;
    let tab = '正文';

    replace(host, loadingBlock(3));
    try {
        const data = await call('exhibitions.get', { id: context.params.id });
        if (!data?.found) {
            replace(host, stateBlock({
                tone: 'error',
                title: '展会不存在',
                description: data?.error || '无法加载展会简介。',
                action: { label: '返回展商后台', onClick: () => context.navigate('exhibitor') },
            }));
            return;
        }
        exhibition = data.exhibition;
    } catch (error) {
        replace(host, stateBlock({
            tone: 'error',
            title: '加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
        return;
    }

    const editor = el('div', {
        class: 'editor-surface',
        contenteditable: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': '展会简介正文',
        'data-placeholder': '输入展会简介，可插入标题、列表、链接与图片',
    });
    let bodyHtml = sanitizeHtml(exhibition.description || '');
    editor.innerHTML = bodyHtml;
    editor.addEventListener('input', () => {
        bodyHtml = editor.innerHTML;
    });

    render();

    function render() {
        const media = state.media || {};
        const tabs = el('div', { class: 'seg', role: 'group', 'aria-label': '编辑区域' });
        for (const name of ['正文', '图片', '视频']) {
            append(tabs, el('button', {
                type: 'button',
                'aria-pressed': name === tab ? 'true' : 'false',
                onclick: () => {
                    tab = name;
                    render();
                },
            }, [name]));
        }

        // 切换标签时编辑器会重建，用最新内容恢复，避免丢失未保存的输入。
        editor.innerHTML = bodyHtml;

        replace(host, [
            tabs,
            tab === '正文' ? toolbar() : null,
            tab === '正文' ? editor : null,
            tab === '正文' ? null : mediaPanel(tab, media),
            el('p', { class: 'field-hint', text: `媒体数量与大小受系统设置限制：图片 ${media.imageCount || 8} 张 / 单张 ${media.imageSizeMb || 10} MB，视频 ${media.videoCount || 2} 个。` }),
        ]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', { class: 'cta', type: 'button', onclick: () => save() }, ['保存简介']),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '保存后详情页会按富文本渲染。' }),
        ]));
    }

    /** 工具栏：加粗、斜体、标题、列表、引用、链接与图片。 */
    function toolbar() {
        const bar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '富文本工具' });
        const commands = [
            { label: '标题', command: 'formatBlock', value: 'h3' },
            { label: 'B', command: 'bold', title: '加粗' },
            { label: 'I', command: 'italic', title: '斜体' },
            { label: '清单', command: 'insertUnorderedList' },
            { label: '编号', command: 'insertOrderedList' },
            { label: '引用', command: 'formatBlock', value: 'blockquote' },
            { label: '正文', command: 'formatBlock', value: 'p' },
        ];
        for (const item of commands) {
            append(bar, el('button', {
                type: 'button',
                title: item.title || item.label,
                onclick: () => {
                    editor.focus();
                    document.execCommand(item.command, false, item.value || null);
                },
            }, [item.label]));
        }
        append(bar, el('button', {
            type: 'button',
            title: '插入链接',
            onclick: () => insertLink(),
        }, ['链接']));
        append(bar, el('button', {
            type: 'button',
            title: '插入图片',
            onclick: () => insertImage(),
        }, ['图片']));
        append(bar, el('button', {
            type: 'button',
            title: '插入分割线',
            onclick: () => {
                editor.focus();
                document.execCommand('insertHorizontalRule');
            },
        }, ['分割线']));
        return bar;
    }

    function mediaPanel(name, media) {
        const images = Array.from(editor.querySelectorAll('img'));
        const limit = name === '图片' ? (media.imageCount || 8) : (media.videoCount || 2);
        const tiles = name === '图片' && images.length > 0
            ? el('div', { class: 'media-grid' }, images.map((image, index) => el('div', { class: 'media-tile' }, [
                el('img', { src: image.src, alt: image.alt || `展会图片 ${index + 1}` }),
                el('button', {
                    type: 'button',
                    'aria-label': `删除第 ${index + 1} 张图片`,
                    onclick: () => {
                        image.remove();
                        toast('已删除图片');
                        render();
                    },
                }, ['×']),
            ])))
            : stateBlock({
                iconName: name === '图片' ? 'image' : 'video',
                title: name === '图片' ? '还没有插入图片' : '视频素材说明',
                description: name === '图片'
                    ? `当前 ${images.length} / ${limit} 张，点击下方按钮从设备选择。`
                    : `演示环境使用系统媒体选择器，视频最多 ${limit} 个；上传能力待服务端接口接入。`,
            });

        const actions = el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', {
                class: 'cta ghost',
                type: 'button',
                disabled: name === '图片' ? (images.length >= limit ? true : null) : true,
                onclick: () => (name === '图片' ? insertImage() : pickVideo()),
            }, [name === '图片' ? '插入图片' : '选择视频']),
        ]);

        return el('div', { class: 'stack' }, [tiles, actions]);
    }

    function insertLink() {
        const url = window.prompt('输入链接地址', 'https://');
        if (!url) {
            return;
        }
        editor.focus();
        document.execCommand('createLink', false, url);
    }

    async function insertImage() {
        const media = state.media || {};
        const images = editor.querySelectorAll('img').length;
        const limit = media.imageCount || 8;
        if (images >= limit) {
            toast(`图片数量已达上限（${limit} 张）`, 'error');
            return;
        }
        try {
            const result = await call('media.pickImage');
            if (!result?.dataUrl) {
                toast('未能读取所选图片', 'error');
                return;
            }
            if (!isWithinSizeLimit(result.dataUrl, (media.imageSizeMb || 10) * 1024 * 1024)) {
                toast(`图片超过 ${media.imageSizeMb || 10} MB 限制`, 'error');
                return;
            }
            editor.focus();
            document.execCommand('insertHTML', false, `<img src="${result.dataUrl}" alt="展会图片" />`);
            toast('图片已插入', 'success');
            tab = '正文';
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function pickVideo() {
        try {
            const result = await call('media.pickVideo');
            toast(`已选择素材：${result?.uri ? '本地文件' : '未选择'}；视频上传待服务端接口接入`, 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function isWithinSizeLimit(dataUrl, limitBytes) {
        const base64 = String(dataUrl).split(',')[1] || '';
        const bytes = Math.floor((base64.length * 3) / 4);
        return bytes <= limitBytes;
    }

    async function save() {
        const html = isBlankHtml(bodyHtml) ? '' : sanitizeHtml(bodyHtml);
        saveButton.disabled = true;
        try {
            const result = await call('exhibitions.save', {
                id: exhibition.id,
                title: exhibition.title,
                venue: exhibition.venue,
                time: exhibition.time,
                status: exhibition.status,
                category: exhibition.category,
                date: exhibition.date,
                description: html,
                registrationStart: exhibition.registrationStart,
                registrationEnd: exhibition.registrationEnd,
            });
            if (!result?.ok) {
                toast(result?.error || '保存失败', 'error');
                return;
            }
            exhibition = result.exhibition;
            bodyHtml = sanitizeHtml(exhibition.description || '');
            toast('简介已保存', 'success');
            context.navigate('exhibition-form', { id: exhibition.id }, { replace: true });
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            saveButton.disabled = false;
        }
    }
}
