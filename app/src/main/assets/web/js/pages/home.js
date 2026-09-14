/**
 * 屏幕 02 · 首页（月视图 + 当天展会列表）
 * 线框：newUI/index.html #screen-home、newUI/remaining-ui.html #screen-home
 * 业务：ExhibitionManager 展会数据 + RegistrationManager 报名状态。
 */

import { call, state } from '../core/bridge.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { icon, loadingBlock, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, append, replace, daysInMonth, firstWeekdayOffset, addMonths, monthLabel } from '../core/dom.js';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export async function homePage(context) {
    // 演示数据集中在 2026 年 6–8 月，默认落到第一个有展会的月份（2026 年 6 月）。
    const view = {
        year: Number(context.params.year) || 2026,
        month: Number(context.params.month) || 6,
        day: Number(context.params.day) || 0,
    };

    const listHost = el('div', { class: 'list', 'data-gap': 'sm' });
    const calendarHost = el('div', { class: 'calendar' });
    const monthTitle = el('strong', { text: monthLabel(view.year, view.month) });
    const selectedTitle = el('strong', { text: '当日展会' });
    const selectedMeta = el('span', { class: 'dim' });
    const noticeHost = el('div');

    const body = scaffold({
        title: '首页',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [topAction('search', '搜索展会', () => context.navigate('search'))],
        foot: tabbar({ items: navItems(), active: 'home' }),
        children: [
            el('header', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: 'calMobile' }),
                    el('h2', { text: '发现展会' }),
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
            calendarHost,
            el('div', { class: 'row', 'data-between': 'true' }, [selectedTitle, selectedMeta]),
            listHost,
        ],
    });

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

    async function load() {
        replace(calendarHost, loadingBlock(1));
        replace(listHost, loadingBlock(2));
        try {
            const data = await call('exhibitions.month', view);
            view.month = data.month;
            view.year = data.year;
            monthTitle.textContent = data.monthLabel;
            renderCalendar(data);
            renderList(data);
        } catch (error) {
            replace(calendarHost, stateBlock({
                tone: 'error',
                title: '展会数据加载失败',
                description: error.message,
                action: { label: '重试', onClick: () => load() },
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

        for (let index = 0; index < offset; index += 1) {
            const day = previousTotal - offset + index + 1;
            append(grid, dayButton(day, { muted: true, disabled: true }));
        }
        for (let day = 1; day <= total; day += 1) {
            append(grid, dayButton(day, { hasEvent: eventDays.has(day), selected: day === view.day }));
        }
        const trailing = (7 - ((offset + total) % 7)) % 7;
        for (let day = 1; day <= trailing; day += 1) {
            append(grid, dayButton(day, { muted: true, disabled: true }));
        }

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
            text: String(day),
            onclick: () => {
                view.day = day;
                load();
            },
        });
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
            el('span', { class: 'thumb ph-img thumb-sm', 'aria-hidden': 'true' }),
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

    function shiftMonth(delta) {
        const next = addMonths(view.year, view.month, delta);
        view.year = next.year;
        view.month = next.month;
        view.day = 1;
        load();
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
