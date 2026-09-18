import { t } from '../core/strings.js';
/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 * 线框：newUI/index.html #screen-home、newUI/remaining-ui.html #screen-home
 * 业务：展会与报名数据来自 server/ 的 REST 接口（统一走 core/api.js）。
 *
 * 日历卡片支持左右滑动切换月份：拖动时卡片跟手位移，松手超过阈值则滑出并载入相邻月份；
 * 需要六行才能排满的月份会额外多出一行，同时压缩行高，保证整张卡片仍然可见。
 *
 * ## 为什么点日期不发请求
 *
 * `exhibitions.month` 一次就返回**整个月**的展会（`exhibitions` 字段带 day），
 * 所以「选中哪一天」纯属本地状态：点日期只改 `aria-pressed` 与下方列表，
 * 既不重新取数，也不重建日历 DOM（重建会让整块卡片闪一下、圆点动画重放）。
 * 以前每点一天都重新请求整月数据、把日历换成骨架屏，那一下空档就是它造成的。
 */

import { state } from '../core/bridge.js';
import { exhibitions } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { homeParams, preloadFollowUps, warmOnPress } from '../core/preload.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { icon, loadErrorBlock, loadingBlock, mediaBox, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, append, replace, daysInMonth, firstWeekdayOffset, addMonths, monthLabel } from '../core/dom.js';

const WEEK_LABELS = [t('s_1hqqsf'), t('s_12482qz'), t('s_3fnyn8'), t('s_q67h2y'), t('s_14c4war'), t('s_1sgquew'), t('s_qsy6ow')];
const SWIPE_THRESHOLD = 46;

export async function homePage(context) {
    // 落点月份由后端下发（示例数据集中在 2026 年 6–8 月），URL 参数优先。
    const landing = state.calendar.landing || {};
    const view = {
        year: Number(context.params.year) || Number(landing.year) || 2026,
        month: Number(context.params.month) || Number(landing.month) || 6,
        // 0 表示「未指定」：落到当月第一个有展会的日期。
        day: Number(context.params.day) || 0,
    };
    /** 当前月份的完整数据；切换选中日期只用它，不再请求。 */
    let monthData = null;

    const listHost = el('div', { class: 'list', 'data-gap': 'sm' });
    const calendarHost = el('div', { class: 'calendar' });
    const swipeHost = el('div', { class: 'calendar-swipe' }, [calendarHost]);
    const monthTitle = el('strong', { text: monthLabel(view.year, view.month) });
    const selectedTitle = el('strong', { text: t('s_1e4opb2') });
    const selectedMeta = el('span', { class: 'dim' });
    const noticeHost = el('div');

    scaffold({
        title: t('s_1ow5v10'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('search', t('s_50ih74'), () => context.navigate('search'))],
        foot: tabbar({ items: navItems(), active: 'home' }),
        children: [
            el('header', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: state.brand.en }),
                    el('h2', { text: state.brand.zh }),
                ]),
            ]),
            noticeHost,
            el('div', { class: 'row', 'data-between': 'true' }, [
                monthTitle,
                el('div', { class: 'row' }, [
                    monthButton('chevronLeft', t('s_e4jezx'), () => shiftMonth(-1)),
                    monthButton('chevronRight', t('s_y6u3g'), () => shiftMonth(1)),
                ]),
            ]),
            swipeHost,
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: t('s_15hmwa0') }),
            el('div', { class: 'row', 'data-between': 'true' }, [selectedTitle, selectedMeta]),
            listHost,
        ],
    });

    enableSwipe();
    announce();
    await load();
    preloadFollowUps('home', view);

    function monthButton(iconName, label, onClick) {
        return el('button', {
            class: 'icon-button',
            'data-variant': 'outlined',
            type: 'button',
            'aria-label': label,
            title: label,
            onclick: onClick,
        }, [icon(iconName)]);
    }

    // ── 左右滑动切换月份 ───────────────────────────────────────────

    function enableSwipe() {
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let deltaX = 0;
        let axis = '';

        const reset = (animate) => {
            calendarHost.dataset.drag = 'false';
            calendarHost.style.transition = animate
                ? 'transform var(--motion-normal) var(--ease-out)'
                : 'none';
            calendarHost.style.transform = '';
            pointerId = null;
            axis = '';
            deltaX = 0;
        };

        swipeHost.addEventListener('pointerdown', (event) => {
            if (pointerId !== null || event.pointerType === 'mouse') {
                return;
            }
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            deltaX = 0;
            axis = '';
        });

        swipeHost.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointerId) {
                return;
            }
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (axis === '') {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
                    return;
                }
                // 纵向手势交给页面滚动，横向才由日历接管。
                axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                if (axis === 'x') {
                    calendarHost.dataset.drag = 'true';
                    calendarHost.style.transition = 'none';
                }
            }
            if (axis !== 'x') {
                return;
            }
            deltaX = dx;
            // 拖到边界外时阻尼，给出“到头了”的手感。
            const damped = Math.sign(deltaX) * Math.min(Math.abs(deltaX), 96);
            calendarHost.style.transform = `translate3d(${damped * 0.6}px, 0, 0)`;
            event.preventDefault();
        });

        const finish = (event) => {
            if (event.pointerId !== pointerId) {
                return;
            }
            const committed = axis === 'x' && Math.abs(deltaX) >= SWIPE_THRESHOLD;
            const direction = deltaX < 0 ? 1 : -1;
            reset(!committed);
            if (committed) {
                shiftMonth(direction);
            }
        };

        swipeHost.addEventListener('pointerup', finish);
        swipeHost.addEventListener('pointercancel', (event) => {
            if (event.pointerId === pointerId) {
                reset(true);
            }
        });
        swipeHost.addEventListener('pointerleave', (event) => {
            if (event.pointerId === pointerId) {
                reset(true);
            }
        });
    }

    function prefersReducedMotion() {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * 载入当前 `view` 对应的月份。
     *
     * 缓存命中时同步出内容（切月份因此没有空档），未命中才显示骨架屏；
     * 容器里已有上个月的内容时不会清空，只标记 data-busy。
     */
    async function load() {
        // 首屏同时要给列表留占位；缓存命中时它会在同一帧里被替换掉，不会露面。
        if (listHost.childElementCount === 0) {
            replace(listHost, loadingBlock(2));
        }
        await loadInto(calendarHost, {
            read: exhibitions.month,
            params: homeParams(view),
            rows: 1,
            errorTitle: t('s_1tbhtoh'),
            render: applyMonth,
            onError: (error) => {
                replace(calendarHost, loadErrorBlock({
                    title: t('s_1tbhtoh'),
                    description: error.message,
                    onRetry: () => load(),
                }));
                replace(listHost, []);
            },
        });
    }

    /** 把一份月数据落到日历与列表上。缓存与远端结果都走这里。 */
    function applyMonth(data) {
        monthData = data;
        // 年月一律以**发起这次加载时**的 view 为准：切月份时 view 在请求发出前就
        // 已经改好了，若再用响应里的 year / month 反写，迟到的旧响应会把日历和
        // 列表一起拽回上个月（loadInto 的过期守卫已经丢弃迟到结果，这里再兜一层）。
        // 表头同理，用 view 拼而不是直接用响应里的 monthLabel，否则出现
        // 「表头写 6 月、格子排 7 月」这种自相矛盾的画面。
        // 只有还没选中日期时才采用后端给的落点，避免刷新的结果覆盖用户的选择。
        if (!view.day) {
            view.day = Number(data.day) || 0;
        }
        monthTitle.textContent = monthLabel(view.year, view.month);
        renderCalendar();
        renderList();
    }

    function renderCalendar() {
        const eventDays = new Set(monthData.eventDays || []);
        const total = daysInMonth(view.year, view.month);
        const offset = firstWeekdayOffset(view.year, view.month);
        const previous = addMonths(view.year, view.month, -1);
        const previousTotal = daysInMonth(previous.year, previous.month);
        // 六行月份（例如 2026 年 8 月）需要额外一行才能排下全部日期。
        const rows = Math.ceil((offset + total) / 7);
        const grid = el('div', { class: 'calendar-grid' });

        for (let index = 0; index < offset; index += 1) {
            const day = previousTotal - offset + index + 1;
            append(grid, dayButton(day, { muted: true, disabled: true }));
        }
        for (let day = 1; day <= total; day += 1) {
            append(grid, dayButton(day, { hasEvent: eventDays.has(day) }));
        }
        const trailing = (rows * 7) - offset - total;
        for (let day = 1; day <= trailing; day += 1) {
            append(grid, dayButton(day, { muted: true, disabled: true }));
        }

        // 行数写进 data-rows：六行月份时 CSS 会给日历卡片额外一行并压缩行高。
        calendarHost.setAttribute('data-rows', String(rows));
        replace(calendarHost, [
            el('div', { class: 'week-row', 'aria-hidden': 'true' },
                WEEK_LABELS.map((label) => el('span', { text: label }))),
            grid,
        ]);
    }

    function dayButton(day, { muted, hasEvent, disabled }) {
        return el('button', {
            class: 'cal-day',
            type: 'button',
            dataset: {
                day: String(day),
                muted: muted ? 'true' : 'false',
                hasEvent: hasEvent ? 'true' : 'false',
            },
            'aria-pressed': day === view.day ? 'true' : 'false',
            'aria-label': `${view.month}月${day}日${hasEvent ? t('s_1hzbri3') : ''}${day === view.day ? t('s_19g8l4d') : ''}`,
            disabled: disabled ? true : null,
            onclick: () => selectDay(day),
        }, [
            // 数字单独一层：选中态只在数字下方画一小段下划线，不给整格加方框。
            el('span', { class: 'cal-day-num', text: String(day) }),
        ]);
    }

    /**
     * 选中某一天：只改选中态与下面的列表。
     * 不重新取数、不重建日历，因此没有任何空档，圆点弹入动画也只在新选中的那天播放。
     */
    function selectDay(day) {
        if (view.day === day) {
            return;
        }
        view.day = day;
        for (const button of calendarHost.querySelectorAll('.cal-day')) {
            button.setAttribute('aria-pressed', button.dataset.day === String(day) ? 'true' : 'false');
        }
        renderList();
    }

    function renderList() {
        const day = view.day;
        const items = day > 0
            ? (monthData?.exhibitions || []).filter((item) => item.day === day)
            : [];
        selectedTitle.textContent = day > 0
            ? `${view.month} 月 ${day} 日的展会`
            : t('s_1e4opb2');
        selectedMeta.textContent = items.length > 0 ? `共 ${items.length} 场` : t('s_xwhfsg');

        if (items.length === 0) {
            replace(listHost, stateBlock({
                title: t('s_1vtk64c'),
                description: t('s_1jbzuzw'),
                action: { label: t('s_50ih74'), onClick: () => context.navigate('search') },
            }));
            return;
        }

        replace(listHost, items.map((item) => el('button', {
            class: 'row-card',
            type: 'button',
            dataset: { pressable: 'true' },
            'aria-label': `查看 ${item.title} 详情`,
            ...warmOnPress(exhibitions.get, { id: item.id }),
            onclick: () => context.navigate('detail', { id: item.id }),
        }, [
            mediaBox({ src: item.imageUri, className: 'thumb thumb-cover' }),
            el('span', { class: 'row-copy' }, [
                el('span', { class: 'row', 'data-gap': 'md' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    statusTag(item.modeLabel || item.status, statusTone(item.status)),
                ]),
                el('span', { class: 'row-meta', text: `${item.time} · ${item.venue}` }),
                el('span', { class: 'row-meta truncate', text: item.category || '' }),
            ]),
        ])));
    }

    /**
     * 切换月份：有动画时先让当前卡片滑出，再载入新月份并滑入，
     * 让“月份变了”这件事在视觉上连续。
     *
     * 相邻月份已由 core/preload.js 预热，因此这里通常直接命中缓存、当场换页。
     */
    function shiftMonth(delta) {
        const next = addMonths(view.year, view.month, delta);
        const apply = () => {
            view.year = next.year;
            view.month = next.month;
            // 交给新月份自己挑第一个有展会的日期。
            view.day = 0;
            calendarHost.dataset.enter = delta > 0 ? 'right' : 'left';
            load().then(() => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => {
                        calendarHost.dataset.enter = '';
                    });
                }
                preloadFollowUps('home', view);
            });
        };
        if (prefersReducedMotion()) {
            apply();
            return;
        }
        calendarHost.dataset.leave = delta > 0 ? 'left' : 'right';
        setTimeout(() => {
            delete calendarHost.dataset.leave;
            apply();
        }, 140);
    }

    /** 启动公告：仅在开关打开且未读时提示一次。 */
    function announce() {
        if (!state.announcement.enabled || !state.announcement.text) {
            return;
        }
        const key = `announcement:${state.announcement.text}`;
        try {
            if (localStorage.getItem(key)) {
                return;
            }
            localStorage.setItem(key, '1');
        } catch (ignored) {
            // 隐私模式下忽略存储失败，仍然提示一次
        }
        replace(noticeHost, el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
            el('strong', { text: t('s_153oaxf') }),
            el('span', { text: state.announcement.text }),
        ]));
        toast(state.announcement.text);
    }
}
