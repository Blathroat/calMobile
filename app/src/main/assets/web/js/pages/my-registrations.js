import { t } from '../core/strings.js';
/**
 * 屏幕 07 · 我的报名（列表）
 * 线框：newUI/remaining-ui.html #screen-my-registrations
 * 业务：RegistrationManager.list，状态文字保留“待审核 / 已通过 / 已撤销”。
 *
 * 取数走 core/loadable.js：命中缓存时同步出内容，因此从底部导航切过来不会先闪骨架屏。
 */

import { state } from '../core/bridge.js';
import { registrations } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { warmOnPress } from '../core/preload.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, truncate, formatRecordDate } from '../core/dom.js';

export async function myRegistrationsPage(context) {
    const listHost = el('div', { class: 'list', 'data-gap': 'sm' });
    const countPill = el('span', { class: 'pill', text: '—' });

    scaffold({
        title: t('s_1m2dh8u'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'my-registrations' }),
        children: [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    el('span', { class: 'eyebrow', text: state.brand.en }),
                    el('h2', { text: t('s_1m2dh8u') }),
                ]),
                countPill,
            ]),
            listHost,
        ],
    });

    if (!state.user.loggedIn) {
        replace(listHost, stateBlock({
            iconName: 'user',
            title: t('s_1eiqw54'),
            description: t('s_mf99no'),
            action: { label: t('s_533bde'), onClick: () => context.navigate('login', { redirect: 'my-registrations' }) },
        }));
        countPill.textContent = t('s_1ydrtwl');
        return;
    }

    await loadInto(listHost, {
        read: registrations.list,
        rows: 3,
        errorTitle: t('s_1wh1onp'),
        render: (records) => {
            countPill.textContent = `${records.length} 条记录`;
            if (records.length === 0) {
                replace(listHost, stateBlock({
                    iconName: 'ticket',
                    title: t('s_a8pyd6'),
                    description: t('s_yfjo64'),
                    action: { label: t('s_11ps4x5'), onClick: () => context.navigate('home') },
                }));
                return;
            }
            replace(listHost, records.map((record) => el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                'aria-label': `查看 ${record.exhibitionTitle} 的报名详情`,
                ...warmOnPress(registrations.get, { id: record.id }),
                onclick: () => context.navigate('registration-detail', { id: record.id }),
            }, [
                el('span', { class: 'thumb ph-img', 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: record.exhibitionTitle }),
                    el('span', { class: 'row-meta', text: `${formatRecordDate(record)} ${record.exhibitionTime}` }),
                    el('span', { class: 'row-meta truncate', text: record.exhibitionVenue }),
                    el('span', { class: 'row-meta truncate', text: `报名信息：${truncate(record.answers || t('s_v8pba2'), 34)}` }),
                ]),
                statusTag(record.statusLabel, statusTone(record.statusLabel)),
            ])));
        },
    });
}
