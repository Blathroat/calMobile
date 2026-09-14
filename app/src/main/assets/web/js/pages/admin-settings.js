/**
 * 屏幕 17 · 系统设置（管理员）
 * 线框：newUI/remaining-ui.html #screen-admin-settings
 * 业务：AppSettings 持久化应用配色、启动公告、展会分类、重新审核开关与富文本媒体限制。
 */

import { call, state, applyTheme } from '../core/bridge.js';
import { scaffold, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, switchRow, toast } from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';

export async function adminSettingsPage(context) {
    const host = el('div', { class: 'stack' });
    const saveButton = topAction('save', '保存设置', () => save());
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });

    scaffold({
        title: '系统设置',
        backTo: 'admin',
        bodyProps: { 'data-gap': 'tight' },
        actions: [saveButton],
        foot,
        children: [host],
    });

    let settings = null;
    replace(host, loadingBlock(4));
    try {
        settings = await call('settings.get');
    } catch (error) {
        replace(host, stateBlock({
            tone: 'error',
            title: '设置加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
        return;
    }

    let themeIndex = settings.theme?.index ?? 0;
    let announcementEnabled = Boolean(settings.announcement?.enabled);
    let canRevise = Boolean(settings.review?.canRevise);

    const announcementText = textarea('settings-announcement', settings.announcement?.text || '');
    const categoriesText = textarea('settings-categories', (settings.categories || []).join('\n'));
    const imageCount = numberInput('settings-image-count', settings.media?.imageCount ?? 8);
    const imageSize = numberInput('settings-image-size', settings.media?.imageSizeMb ?? 10);
    const videoCount = numberInput('settings-video-count', settings.media?.videoCount ?? 2);

    render();

    function render() {
        const colors = settings.theme?.colors || [];
        const palette = el('div', { class: 'cluster' });
        colors.forEach((color, index) => {
            append(palette, el('button', {
                type: 'button',
                'aria-label': `配色 ${index + 1} ${color}`,
                'aria-pressed': index === themeIndex ? 'true' : 'false',
                title: color,
                style: {
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: color,
                    border: index === themeIndex ? '3px solid var(--ink)' : '1px solid var(--stroke)',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: '700',
                },
                onclick: () => {
                    themeIndex = index;
                    render();
                },
            }, [color.replace('#', '')]));
        });

        replace(host, [
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '应用配色' }),
                palette,
                el('p', { class: 'field-hint', text: '配色作用于强调色、状态标签与系统栏，保存后立即生效。' }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '进入应用时的公告' }),
                announcementText,
                switchRow({
                    id: 'settings-announcement-enabled',
                    label: '进入应用时显示公告',
                    description: '用户打开首页时展示一次',
                    checked: announcementEnabled,
                    onChange: (value) => {
                        announcementEnabled = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '展会分类管理' }),
                categoriesText,
                el('p', { class: 'field-hint', text: '每行一个分类，用于展商填写与搜索筛选。' }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '审核策略' }),
                switchRow({
                    id: 'settings-revise',
                    label: '允许修改已通过或已拒绝的报名',
                    description: '开启后展商可以重新审核已处理的报名',
                    checked: canRevise,
                    onChange: (value) => {
                        canRevise = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '富文本媒体限制' }),
                numberField('每篇图片数量上限', imageCount, '张'),
                numberField('单张图片大小', imageSize, 'MB'),
                numberField('视频数量上限', videoCount, '个'),
                el('div', { class: 'notice' }, [
                    el('strong', { text: '设置范围明确' }),
                    el('span', { text: '当前作用于富文本编辑器的上传提示与数量校验，媒体文件仍保存在设备本地。' }),
                ]),
            ]),
        ]);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('button', { class: 'cta', type: 'button', onclick: () => save() }, ['保存设置']),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '保存后应用到新编辑内容与全应用配色。' }),
        ]));
    }

    function numberField(label, control, suffix) {
        return el('div', { class: 'field' }, [
            el('label', { for: control.id, text: label }),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                control,
                el('span', { class: 'row-meta', text: suffix }),
            ]),
        ]);
    }

    function textarea(id, value) {
        const control = el('textarea', { class: 'textarea', id, rows: 3 });
        control.value = value;
        return control;
    }

    function numberInput(id, value) {
        return el('input', {
            class: 'input',
            id,
            type: 'number',
            min: '0',
            value: String(value),
            inputmode: 'numeric',
        });
    }

    async function save() {
        saveButton.disabled = true;
        try {
            const result = await call('settings.save', {
                themeIndex,
                announcement: announcementText.value.trim(),
                announcementEnabled,
                categories: categoriesText.value.split('\n').map((item) => item.trim()).filter(Boolean),
                canRevise,
                imageCount: Number(imageCount.value) || 0,
                imageSizeMb: Number(imageSize.value) || 0,
                videoCount: Number(videoCount.value) || 0,
            });
            if (!result?.ok) {
                toast('保存失败', 'error');
                return;
            }
            settings = result.settings;
            Object.assign(state.theme, settings.theme || {});
            Object.assign(state.announcement, settings.announcement || {});
            Object.assign(state.media, settings.media || {});
            Object.assign(state.review, settings.review || {});
            state.categories = settings.categories || state.categories;
            applyTheme();
            toast('设置已保存', 'success');
            context.refresh();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            saveButton.disabled = false;
        }
    }
}
