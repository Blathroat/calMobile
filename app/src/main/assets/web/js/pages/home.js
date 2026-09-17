/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 * 线框：newUI/index.html #screen-home、newUI/remaining-ui.html #screen-home
 * 业务：ExhibitionManager 展会数据 + RegistrationManager 报名状态。
 *
 * 日历卡片支持左右滑动切换月份：拖动时卡片跟手位移，松手超过阈值则滑出并载入相邻月份；
 * 需要六行才能排满的月份会额外多出一行，同时压缩行高，保证整张卡片仍然可见。
 */

import { call, state } from '../core/bridge.js';
import { exhibitions } from '../core/api.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { icon, loadErrorBlock, loadingBlock, mediaBox, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, append, replace, daysInMonth, firstWeekdayOffset, addMonths, monthLabel } from '../core/dom.js';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const SWIPE_THRESHOLD = 46;

export async function homePage(context) {
    // 演示数据集中在 2026 年 6–8 月，默认落到第一个有展会的月份（2026 年 6 月）。
    const view = {
        year: Number(context.params.year) || 2026,
        month: Number(context.params.month) || 6,
        day: Number(context.params.day) || 0,
    };

    const listHost = el('div', { class: 'list', 'data-gap': 'sm' });
    const calendarHost = el('div', { class: 'calendar' });
    const swipeHost = el('div', { class: 'calendar-swipe' }, [calendarHost]);
    const monthTitle = el('strong', { text: monthLabel(view.year, view.month) });
    const selectedTitle = el('strong', { text: '当日展会' });
    const selectedMeta = el('span', { class: 'dim' });
    const noticeHost = el('div');

    scaffold({
        title: '首页',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('search', '搜索展会', () => context.navigate('search'))],
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
                    monthButton('chevronLeft', '上一个月', () => shiftMonth(-1)),
                    monthButton('chevronRight', '下一个月', () => shiftMonth(1)),
                ]),
            ]),
            swipeHost,
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '左右滑动日历卡片可以切换月份。' }),
            el('div', { class: 'row', 'data-between': 'true' }, [selectedTitle, selectedMeta]),
            listHost,
        ],
    });

    enableSwipe();
    announce();
    await load();

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

    async function load(explicit = false) {
        replace(calendarHost, loadingBlock(1));
        replace(listHost, loadingBlock(2));
        try {
            const data = await exhibitions.month({ ...view, explicit });
            view.month = data.month;
            view.year = data.year;
            // 选中日期以服务端结果为准，首次进入与翻月后都能正确高亮。
            view.day = Number(data.day) || 0;
            monthTitle.textContent = data.monthLabel;
            renderCalendar(data);
            renderList(data);
        } catch (error) {
            replace(calendarHost, loadErrorBlock({
                title: '展会数据加载失败',
                description: error.message,
                onRetry: () => load(),
            }));
            replace(listHost, []);
        }
    }

    function renderCalendar(data) {
        const grid = el('div', { class: 'calendar-grid' });
        const eventDays = new Set(data.eventDays || []);
        const total = daysInMonth(view.year, view.month);
        const offset = firstWeekdayOffset(view.year, view.month);
        const previous = addMonths(view.year, view.month, -1);
        const previousTotal = daysInMonth(previous.year, previous.month);
        // 六行月份（例如 2026 年 8 月）需要额外一行才能排下全部日期。
        const rows = Math.ceil((offset + total) / 7);

        for (let index = 0; index < offset; index += 1) {
            const day = previousTotal - offset + index + 1;
            append(grid, dayButton(day, { muted: true, disabled: true }));
        }
        for (let day = 1; day <= total; day += 1) {
            append(grid, dayButton(day, { hasEvent: eventDays.has(day), selected: day === view.day }));
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

    function dayButton(day, { muted, hasEvent, selected, disabled }) {
        return el('button', {
            class: 'cal-day',
            type: 'button',
            dataset: {
                muted: muted ? 'true' : 'false',
                hasEvent: hasEvent ? 'true' : 'false',
            },
            'aria-pressed': selected ? 'true' : 'false',
            'aria-label': `${view.month}月${day}日${hasEvent ? '有展会' : ''}${selected ? '，已选择' : ''}`,
            disabled: disabled ? true : null,
            onclick: () => {
                if (view.day === day) {
                    return;
                }
                view.day = day;
                load();
            },
        }, [
            // 数字单独一层：选中态只在数字下方画一小段下划线，不给整格加方框。
            el('span', { class: 'cal-day-num', text: String(day) }),
        ]);
    }

    function renderList(data) {
        const items = data.selected || [];
        selectedTitle.textContent = `${data.month} 月 ${data.day} 日的展会`;
        selectedMeta.textContent = items.length > 0 ? `共 ${items.length} 场` : '暂无安排';

        if (items.length === 0) {
            replace(listHost, stateBlock({
                title: '这一天还没有展会',
                description: '可以切换到相邻日期，或搜索其它城市与分类的展会。',
                action: { label: '搜索展会', onClick: () => context.navigate('search') },
            }));
            return;
        }

        replace(listHost, items.map((item) => el('button', {
            class: 'row-card',
            type: 'button',
            dataset: { pressable: 'true' },
            'aria-label': `查看 ${item.title} 详情`,
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
     */
    function shiftMonth(delta) {
        const next = addMonths(view.year, view.month, delta);
        const apply = () => {
            view.year = next.year;
            view.month = next.month;
            view.day = 1;
            calendarHost.dataset.enter = delta > 0 ? 'right' : 'left';
            load(true).then(() => {
                if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => {
                        calendarHost.dataset.enter = '';
                    });
                }
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
            el('strong', { text: '公告' }),
            el('span', { text: state.announcement.text }),
        ]));
        toast(state.announcement.text);
    }
}
