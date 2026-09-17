import { t } from '../core/strings.js';
/**
 * 屏幕 14 · 用户公开页
 * 线框：newUI/remaining-ui.html #screen-user-public
 * 业务：展示昵称、简介、所在地区与报名记录。
 *
 * 普通访问者按用户的“展示我的报名”策略过滤；管理员从管理后台进入时不受该策略影响，
 * 始终能查看用户已参加的展会（页面会说明当前是管理视角）。
 */

import { call, state } from '../core/bridge.js';
import { users } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { avatarNode, loadErrorBlock, loadingBlock, pageFoot, stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, formatDateWithWeekday } from '../core/dom.js';

export async function userPublicPage(context) {
    const host = el('div', { class: 'stack' });
    const isOwn = Boolean(context.params.nickname && state.user.nickname
        && context.params.nickname === state.user.nickname);
    const foot = pageFoot();

    scaffold({
        title: t('s_1g1m28r'),
        backTo: 'home',
        bodyProps: { 'data-gap': 'tight' },
        foot,
        children: [host],
    });

    replace(host, loadingBlock(3));
    let profile = null;
    try {
        const data = await users.publicProfile({
            nickname: context.params.nickname || '',
            userId: context.params.userId || '',
        });
        if (!data?.found) {
            replace(host, stateBlock({
                iconName: 'user',
                title: t('s_8wvztz'),
                description: data?.error || t('s_jvqxyf'),
                action: { label: t('s_17zyr1e'), onClick: () => context.navigate('home') },
            }));
            replace(foot, []);
            return;
        }
        profile = data;
    } catch (error) {
        replace(host, loadErrorBlock({
            title: t('s_kvpltc'),
            description: error.message,
            onRetry: () => context.refresh(),
        }));
        return;
    }

    render();

    function render() {
        const registrations = profile.registrations || [];
        // 管理视角：管理员看得到全部已参加展会，页面明确说明，避免误解为公开范围。
        const adminView = profile.viewedAsAdmin === true;
        replace(host, [
            adminView
                ? el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
                    el('strong', { text: t('s_1tdesxa') }),
                    el('span', { text: t('s_10tql41') }),
                ])
                : null,
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    avatarNode({ src: profile.avatar, name: profile.nickname, className: 'avatar' }),
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: profile.nickname }),
                        el('span', { class: 'row-meta', text: `${profile.role}${isOwn ? t('s_1dev7g3') : ''}` }),
                        el('span', { class: 'row-meta', text: profile.bio || t('s_1aifth0') }),
                    ]),
                    statusTag(adminView ? t('s_iq65l2') : (profile.showRegistrations ? t('s_q3pv0x') : t('s_ex547b')),
                        adminView || profile.showRegistrations ? 'ok' : 'muted'),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_wkyvc2') }),
                row(t('s_11ftk7j'), profile.region || t('s_c907jt')),
                row(t('s_1hnvqec'), profile.socialMedia || t('s_lltmb4')),
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: t('s_6osh3w') }),
                    el('span', { class: 'pill', text: `${registrations.length} 条` }),
                ]),
                registrations.length > 0
                    ? el('div', { class: 'list', 'data-gap': 'sm' }, registrations.map((record) => el('div', { class: 'row-card' }, [
                        el('span', { class: 'thumb thumb-cover ph-img thumb-sm', 'aria-hidden': 'true' }),
                        el('span', { class: 'row-copy' }, [
                            el('strong', { class: 'row-title truncate', text: record.exhibitionTitle }),
                            el('span', { class: 'row-meta', text: `${formatDateWithWeekday(`2026-06-${String(record.exhibitionDay).padStart(2, '0')}`)} · ${record.statusLabel}` }),
                        ]),
                        statusTag(record.statusLabel, statusTone(record.statusLabel)),
                    ])))
                    : el('p', {
                        class: 'row-meta',
                        text: profile.showRegistrations
                            ? t('s_8kqs1o')
                            : t('s_g4uu62'),
                    }),
            ]),
        ]);

        replace(foot, [
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate(isOwn ? 'profile' : (adminView ? 'admin' : 'home')),
            }, [isOwn ? t('s_1u66l1') : (adminView ? t('s_1m9kuky') : t('s_17zyr1e'))]),
        ]);
    }

    function row(label, value) {
        return el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: label }),
            el('span', { class: 'strong truncate', text: value }),
        ]);
    }
}
