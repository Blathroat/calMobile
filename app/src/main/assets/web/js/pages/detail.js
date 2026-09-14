/**
 * 屏幕 03 · 展会详情
 * 线框：newUI/index.html #screen-detail、newUI/remaining-ui.html #screen-detail
 * 业务：展会信息 + 报名收集项 + 系统日历 + 分享。
 */

import { call, state } from '../core/bridge.js';
import { scaffold, topAction } from '../core/router.js';
import { stateBlock, loadingBlock, statusTag, statusTone, toast, openSheet } from '../ui/components.js';
import { sanitizeHtml, plainText } from '../core/sanitize.js';
import { markdownToHtml } from '../core/markdown.js';
import { el, append, replace, formatDateWithWeekday } from '../core/dom.js';

export async function detailPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });
    scaffold({
        title: '展会详情',
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('share', '分享展会', () => share())],
        foot,
        children: [host],
    });

    let exhibition = null;
    let fields = [];
    let calendarState = { inCalendar: false, granted: false };

    replace(host, loadingBlock(3));
    try {
        const data = await call('exhibitions.get', { id: context.params.id });
        if (!data?.found) {
            replace(host, stateBlock({
                tone: 'error',
                title: '展会不存在',
                description: data?.error || '该展会可能已被展商删除。',
                action: { label: '返回首页', onClick: () => context.navigate('home') },
            }));
            replace(foot, []);
            return;
        }
        exhibition = data.exhibition;
        fields = data.fields || [];
    } catch (error) {
        replace(host, stateBlock({
            tone: 'error',
            title: '加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
        return;
    }

    await loadCalendarState();
    render();
    renderFooter();

    async function loadCalendarState() {
        try {
            calendarState = await call('calendar.status', {
                title: exhibition.title,
                day: exhibition.day,
            });
        } catch (ignored) {
            calendarState = { inCalendar: false, granted: false };
        }
    }

    function render() {
        const highlights = exhibition.highlights || [];
        replace(host, [
            heroBlock(),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('h2', { text: exhibition.title }),
                el('p', { class: 'muted', text: `${exhibition.exhibitor} · ${exhibition.exhibitorNote}` }),
            ]),
            el('div', { class: 'card', 'data-tone': 'fill' }, [
                metaRow('calendar', `${formatDateWithWeekday(exhibition.date)} ${exhibition.time}`),
                metaRow('home', exhibition.venue),
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    statusTag(exhibition.modeLabel || exhibition.status, statusTone(exhibition.status)),
                    el('span', { class: 'row-meta', text: exhibition.openForRegistration ? '需提交报名信息' : '当前不可报名' }),
                ]),
            ]),
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                'aria-label': `查看 ${exhibition.exhibitor} 的公开主页`,
                onclick: () => context.navigate('user-public', { nickname: exhibition.exhibitor }),
            }, [
                el('span', { class: 'avatar', text: (exhibition.exhibitor || '展').slice(0, 1), 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: exhibition.exhibitor }),
                    el('span', { class: 'row-meta', text: '查看展商公开主页 →' }),
                ]),
            ]),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: '展会介绍' }),
                descriptionBlock(),
            ]),
            highlights.length > 0
                ? el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'section-label', text: '现场亮点' }),
                    el('div', { class: 'cluster' }, highlights.map((item) => statusTag(item, 'muted'))),
                ])
                : null,
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: '报名信息' }),
                el('p', {
                    class: 'row-meta',
                    text: fields.length > 0
                        ? `展商配置了 ${fields.length} 项信息：${fields.map((field) => field.title).join('、')}`
                        : '该展会未设置额外报名信息，确认后即可提交。',
                }),
            ]),
        ]);
    }

    function heroBlock() {
        const box = el('div', { class: 'hero ph-img' });
        if (exhibition.imageUri) {
            call('media.imageData', { uri: exhibition.imageUri })
                .then((dataUrl) => {
                    if (dataUrl) {
                        append(box, el('img', { src: dataUrl, alt: `${exhibition.title} 展会图片` }));
                    }
                })
                .catch(() => undefined);
        }
        return box;
    }

    function descriptionBlock() {
        const raw = String(exhibition.description || '');
        if (exhibition.descriptionFormat === 'html') {
            if (/<[a-z][\s\S]*>/i.test(raw)) {
                return el('div', { class: 'rich-content', html: sanitizeHtml(raw) });
            }
            const text = plainText(raw, 4000);
            return text
                ? el('p', { class: 'row-meta', style: { fontSize: 'var(--fs-body)', color: 'var(--ink)' }, text })
                : el('p', { class: 'muted', text: '展商还没有补充展会介绍。' });
        }

        // 默认按 Markdown 渲染（编辑器保存的格式），空内容时给出可执行的下一步。
        const html = markdownToHtml(raw);
        if (!html) {
            return el('p', { class: 'muted', text: '展商还没有补充展会介绍。' });
        }
        return el('div', { class: 'rich-content', html });
    }

    function metaRow(iconName, text) {
        return el('div', { class: 'row', 'data-gap': 'md' }, [
            el('span', { class: 'dim', 'aria-hidden': 'true', text: '·' }),
            el('span', { class: 'row-meta', text }),
        ]);
    }

    function canRegister() {
        return state.user.can?.register === true;
    }

    function renderFooter() {
        const calendarButton = el('button', {
            class: 'cta ghost',
            type: 'button',
            onclick: () => toggleCalendar(calendarButton),
        }, [calendarState.inCalendar ? '移出日历' : '加入日历']);

        const registerButton = el('button', {
            class: 'cta',
            type: 'button',
            disabled: exhibition.openForRegistration ? null : true,
            onclick: () => startRegistration(),
        }, [exhibition.openForRegistration
            ? (canRegister() ? '立即报名' : '登录后报名')
            : '报名已关闭']);

        replace(foot, el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('div', { class: 'grid-cols-2' }, [calendarButton, registerButton]),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: footerHint() }),
        ]));
    }

    function footerHint() {
        if (!exhibition.openForRegistration) {
            return `${exhibition.modeLabel || exhibition.status}：该展会当前不接受报名。`;
        }
        if (!canRegister()) {
            return '访客可以浏览详情，报名前需要先登录。';
        }
        return '提交后可在“我的报名”查看审核状态。';
    }

    function startRegistration() {
        if (!canRegister()) {
            toast('请先登录后再报名');
            context.navigate('login', { redirect: 'detail', redirectParams: `id=${encodeURIComponent(exhibition.id)}` });
            return;
        }
        context.navigate('registration-form', { id: exhibition.id });
    }

    async function toggleCalendar(button) {
        button.dataset.loading = 'true';
        try {
            const result = await call('calendar.toggle', {
                title: exhibition.title,
                venue: exhibition.venue,
                time: exhibition.time,
                day: exhibition.day,
                description: plainText(exhibition.description, 200),
            });
            calendarState = { inCalendar: result.inCalendar, granted: result.granted };
            toast(result.message || '已更新系统日历', 'success');
            renderFooter();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.dataset.loading = 'false';
        }
    }

    function share() {
        const text = `${exhibition.title}\n${formatDateWithWeekday(exhibition.date)} ${exhibition.time}\n${exhibition.venue}`;
        openSheet({
            title: '分享展会',
            content: [el('p', { class: 'muted', text: text.replace(/\n/g, ' · ') })],
            actions: [
                { label: '取消', onClick: (close) => close() },
                {
                    label: '分享',
                    variant: 'primary',
                    onClick: async (close) => {
                        close();
                        try {
                            await call('share.text', { title: exhibition.title, text });
                        } catch (error) {
                            toast(error.message, 'error');
                        }
                    },
                },
            ],
        });
    }
}
