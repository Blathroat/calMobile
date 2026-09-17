/**
 * 屏幕 14 · 用户公开页
 * 线框：newUI/remaining-ui.html #screen-user-public
 * 业务：展示昵称、简介、所在地区与报名记录。
 *
 * 普通访问者按用户的“展示我的报名”策略过滤；管理员从管理后台进入时不受该策略影响，
 * 始终能查看用户已参加的展会（页面会说明当前是管理视角）。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { avatarNode, loadErrorBlock, loadingBlock, pageFoot, stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, formatDateWithWeekday } from '../core/dom.js';

export async function userPublicPage(context) {
    const host = el('div', { class: 'stack' });
    const isOwn = Boolean(context.params.nickname && state.user.nickname
        && context.params.nickname === state.user.nickname);
    const foot = pageFoot();

    scaffold({
        title: '用户公开页',
        backTo: 'home',
        bodyProps: { 'data-gap': 'tight' },
        foot,
        children: [host],
    });

    replace(host, loadingBlock(3));
    let profile = null;
    try {
        const data = await call('users.public', {
            nickname: context.params.nickname || '',
            userId: context.params.userId || '',
        });
        if (!data?.found) {
            replace(host, stateBlock({
                iconName: 'user',
                title: '没有可公开的资料',
                description: data?.error || '该用户未公开资料，或账号已停用。',
                action: { label: '返回首页', onClick: () => context.navigate('home') },
            }));
            replace(foot, []);
            return;
        }
        profile = data;
    } catch (error) {
        replace(host, loadErrorBlock({
            title: '加载失败',
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
                    el('strong', { text: '管理视角' }),
                    el('span', { text: '管理员查看公开页不受用户隐私设置限制，下方已参加展会为该用户的完整记录。' }),
                ])
                : null,
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    avatarNode({ src: profile.avatar, name: profile.nickname, className: 'avatar' }),
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: profile.nickname }),
                        el('span', { class: 'row-meta', text: `${profile.role}${isOwn ? ' · 这是你的公开页' : ''}` }),
                        el('span', { class: 'row-meta', text: profile.bio || '该用户还没有填写简介' }),
                    ]),
                    statusTag(adminView ? '管理可见' : (profile.showRegistrations ? '公开' : '部分公开'),
                        adminView || profile.showRegistrations ? 'ok' : 'muted'),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '公开资料' }),
                row('地区', profile.region || '未公开'),
                row('社交账号', profile.socialMedia || '已隐藏'),
            ]),
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: '已参加展会' }),
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
                            ? '还没有可展示的报名记录。'
                            : '该用户选择不展示报名记录。',
                    }),
            ]),
        ]);

        replace(foot, [
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate(isOwn ? 'profile' : (adminView ? 'admin' : 'home')),
            }, [isOwn ? '进入个人主页' : (adminView ? '返回管理后台' : '返回首页')]),
        ]);
    }

    function row(label, value) {
        return el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: label }),
            el('span', { class: 'strong truncate', text: value }),
        ]);
    }
}
