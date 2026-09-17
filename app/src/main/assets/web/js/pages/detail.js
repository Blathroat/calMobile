import { t } from '../core/strings.js';
/**
 * 屏幕 03 · 展会详情
 * 线框：newUI/index.html #screen-detail、newUI/remaining-ui.html #screen-detail
 * 业务：展会信息 + 报名收集项 + 系统日历 + 分享。
 */

import { call, state } from '../core/bridge.js';
import { exhibitions } from '../core/api.js';
import { scaffold, topAction } from '../core/router.js';
import { loadErrorBlock, loadingBlock, notFoundBlock, openSheet, pageFoot, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { sanitizeHtml, plainText } from '../core/sanitize.js';
import { renderMarkdown } from '../core/markdown.js';
import { el, append, replace, formatDateWithWeekday } from '../core/dom.js';

export async function detailPage(context) {
    const host = el('div', { class: 'stack' });
    const foot = pageFoot();
    scaffold({
        title: t('s_1ve1f4n'),
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('share', t('s_e1wq8p'), () => share())],
        foot,
        children: [host],
    });

    let exhibition = null;
    let fields = [];
    let calendarState = { inCalendar: false, granted: false };

    replace(host, loadingBlock(3));
    try {
        const data = await exhibitions.get(context.params.id);
        if (!data?.found) {
            replace(host, notFoundBlock({
                title: t('s_1vim1qp'),
                description: data?.error || t('s_ifhjtv'),
                backLabel: t('s_17zyr1e'),
                onBack: () => context.navigate('home'),
            }));
            replace(foot, []);
            return;
        }
        exhibition = data.exhibition;
        fields = data.fields || [];
    } catch (error) {
        replace(host, loadErrorBlock({
            title: t('s_kvpltc'),
            description: error.message,
            onRetry: () => context.refresh(),
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
                    el('span', { class: 'row-meta', text: exhibition.openForRegistration ? t('s_1gnart') : t('s_105o66n') }),
                ]),
            ]),
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                'aria-label': `查看 ${exhibition.exhibitor} 的公开主页`,
                onclick: () => context.navigate('user-public', { nickname: exhibition.exhibitor }),
            }, [
                el('span', { class: 'avatar', text: (exhibition.exhibitor || t('s_1lsc240')).slice(0, 1), 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: exhibition.exhibitor }),
                    el('span', { class: 'row-meta', text: t('s_1a44i78') }),
                ]),
            ]),
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: t('s_15gixpi') }),
                descriptionBlock(),
            ]),
            highlights.length > 0
                ? el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'section-label', text: t('s_4xp7ge') }),
                    el('div', { class: 'cluster' }, highlights.map((item) => statusTag(item, 'muted'))),
                ])
                : null,
            el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('span', { class: 'section-label', text: t('s_vrp4t3') }),
                el('p', {
                    class: 'row-meta',
                    text: fields.length > 0
                        ? `展商配置了 ${fields.length} 项信息：${fields.map((field) => field.title).join('、')}`
                        : t('s_hadtmi'),
                }),
            ]),
        ]);
    }

    /**
     * 展会封面：设计比例为 1080×1920 的竖版海报。
     * 封面在上传时就已落盘成 `https://appassets.androidplatform.net/media/<文件名>` 短 URL，
     * 因此这里直接交给 <img> 加载，不需要再回读原始 content:// Uri。
     */
    function heroBlock() {
        const box = el('div', { class: 'hero ph-img' });
        const uri = String(exhibition.imageUri || '');
        if (uri) {
            append(box, el('img', { src: uri, alt: `${exhibition.title} 展会图片` }));
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
                : el('p', { class: 'muted', text: t('s_s61azp') });
        }

        // 默认按 Markdown 渲染（编辑器保存的格式）；marked 需要按需加载，因此先占位再填充。
        if (raw.trim() === '') {
            return el('p', { class: 'muted', text: t('s_s61azp') });
        }
        const box = el('div', { class: 'rich-content' }, [loadingBlock(2)]);
        renderMarkdown(raw)
            .then((html) => {
                replace(box, html
                    ? [el('div', { class: 'rich-content', html })]
                    : [el('p', { class: 'muted', text: t('s_s61azp') })]);
            })
            .catch(() => {
                replace(box, [el('p', { class: 'muted', text: t('s_1t9glrp') })]);
            });
        return box;
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
        }, [calendarState.inCalendar ? t('s_dvh8t7') : t('s_1prtpth')]);

        const registerButton = el('button', {
            class: 'cta',
            type: 'button',
            disabled: exhibition.openForRegistration ? null : true,
            onclick: () => startRegistration(),
        }, [exhibition.openForRegistration
            ? (canRegister() ? t('s_nynzo5') : t('s_68p8ln'))
            : t('s_1lfeb57')]);

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
            return t('s_nrshpm');
        }
        return t('s_rss9j6');
    }

    function startRegistration() {
        if (!canRegister()) {
            toast(t('s_1f0kfjp'));
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
            toast(result.message || t('s_1qf1f04'), 'success');
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
            title: t('s_e1wq8p'),
            content: [el('p', { class: 'muted', text: text.replace(/\n/g, ' · ') })],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_16wt7o6'),
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
