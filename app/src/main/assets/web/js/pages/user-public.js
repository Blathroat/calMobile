/**
 * 屏幕 14 · 用户公开页
 * 线框：newUI/remaining-ui.html #screen-user-public
 * 业务：展示用户允许公开的昵称、简介、所在地区与报名记录（受“展示我的报名”策略控制）。
 * 入口保留在管理后台的“公开页”按钮，个人页不再提供入口。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { avatarNode, loadingBlock, stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, formatDateWithWeekday } from '../core/dom.js';

export async function userPublicPage(context) {
    const host = el('div', { class: 'stack' });
    const isOwn = Boolean(context.params.nickname && state.user.nickname
        && context.params.nickname === state.user.nickname);
    const foot = el('div', { style: { padding: 'var(--s4)', background: 'var(--screen)', borderTop: '1px solid var(--stroke)' } });

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
        replace(host, stateBlock({
            tone: 'error',
            title: '加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
        return;
    }

    render();

    function render() {
        const registrations = profile.registrations || [];
        replace(host, [
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    avatarNode({ src: profile.avatar, name: profile.nickname, className: 'avatar' }),
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: profile.nickname }),
                        el('span', { class: 'row-meta', text: `${profile.role}${isOwn ? ' · 这是你的公开页' : ''}` }),
                        el('span', { class: 'row-meta', text: profile.bio || '该用户还没有填写简介' }),
                    ]),
                    statusTag(profile.showRegistrations ? '公开' : '部分公开', profile.showRegistrations ? 'ok' : 'muted'),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '公开资料' }),
                row('地区', profile.region || '未公开'),
                row('社交账号', profile.socialMedia || '已隐藏'),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '已参加展会' }),
                registrations.length > 0
                    ? el('div', { class: 'list', 'data-gap': 'sm' }, registrations.map((record) => el('div', { class: 'row-card' }, [
                        el('span', { class: 'thumb thumb-cover ph-img thumb-sm', 'aria-hidden': 'true' }),
                        el('span', { class: 'row-copy' }, [
                            el('strong', { class: 'row-title truncate', text: record.exhibitionTitle }),
                            el('span', { class: 'row-meta', text: `${formatDateWithWeekday(`2026-06-${String(record.exhibitionDay).padStart(2, '0')}`)} · ${record.statusLabel}` }),
                        ]),
                    ])))
                    : el('p', { class: 'row-meta', text: profile.showRegistrations
                        ? '还没有可展示的报名记录。'
                        : '该用户选择不展示报名记录。' }),
            ]),
        ]);

        replace(foot, [
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate(isOwn ? 'profile' : 'home'),
            }, [isOwn ? '进入个人主页' : '返回首页']),
        ]);
    }

    function row(label, value) {
        return el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: label }),
            el('span', { class: 'strong truncate', text: value }),
        ]);
    }
}
