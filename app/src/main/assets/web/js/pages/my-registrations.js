/**
 * 屏幕 07 · 我的报名（列表）
 * 线框：newUI/remaining-ui.html #screen-my-registrations
 * 业务：RegistrationManager.list，状态文字保留“待审核 / 已通过 / 已撤销”。
 */

import { call, state } from '../core/bridge.js';
import { registrations } from '../core/api.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { loadErrorBlock, loadingBlock, stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, truncate, formatDateWithWeekday } from '../core/dom.js';

export async function myRegistrationsPage(context) {
    const listHost = el('div', { class: 'list', 'data-gap': 'sm' });
    const countPill = el('span', { class: 'pill', text: '—' });

    scaffold({
        title: '我的报名',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'my-registrations' }),
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: state.brand.en }),
                    el('h2', { text: '我的报名' }),
                ]),
                countPill,
            ]),
            listHost,
        ],
    });

    if (!state.user.loggedIn) {
        replace(listHost, stateBlock({
            iconName: 'user',
            title: '登录后查看报名记录',
            description: '访客可以浏览展会详情，报名需要先登录。',
            action: { label: '去登录', onClick: () => context.navigate('login', { redirect: 'my-registrations' }) },
        }));
        countPill.textContent = '未登录';
        return;
    }

    replace(listHost, loadingBlock(3));
    try {
        const records = await registrations.list();
        countPill.textContent = `${records.length} 条记录`;
        if (records.length === 0) {
            replace(listHost, stateBlock({
                iconName: 'ticket',
                title: '暂无报名记录',
                description: '在首页选择日期并打开展会，即可提交报名。',
                action: { label: '去首页看看', onClick: () => context.navigate('home') },
            }));
            return;
        }
        replace(listHost, records.map((record) => el('button', {
            class: 'row-card',
            type: 'button',
            dataset: { pressable: 'true' },
            'aria-label': `查看 ${record.exhibitionTitle} 的报名详情`,
            onclick: () => context.navigate('registration-detail', { id: record.id }),
        }, [
            el('span', { class: 'thumb ph-img', 'aria-hidden': 'true' }),
            el('span', { class: 'row-copy' }, [
                el('strong', { class: 'row-title truncate', text: record.exhibitionTitle }),
                el('span', { class: 'row-meta', text: `${formatDateWithWeekday(`2026-06-${String(record.exhibitionDay).padStart(2, '0')}`)} ${record.exhibitionTime}` }),
                el('span', { class: 'row-meta truncate', text: record.exhibitionVenue }),
                el('span', { class: 'row-meta truncate', text: `报名信息：${truncate(record.answers || '未收集额外信息', 34)}` }),
            ]),
            statusTag(record.statusLabel, statusTone(record.statusLabel)),
        ])));
    } catch (error) {
        replace(listHost, loadErrorBlock({
            title: '报名记录加载失败',
            description: error.message,
            onRetry: () => context.refresh(),
        }));
    }
}
