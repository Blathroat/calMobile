/**
 * 屏幕 09 · 个人主页
 * 线框：newUI/remaining-ui.html #screen-profile
 * 业务：账号资料、公开策略、通知与提醒设置、退出登录。
 */

import { call, state, refreshUser } from '../core/bridge.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { loadingBlock, stateBlock, switchRow, toast, openSheet } from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';

export async function profilePage(context) {
    const host = el('div', { class: 'stack' });
    scaffold({
        title: '个人主页',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'profile' }),
        children: [host],
    });

    if (!state.user.loggedIn) {
        replace(host, stateBlock({
            iconName: 'user',
            title: '当前以访客身份浏览',
            description: '登录后可以维护资料、查看报名记录并接收审核通知。',
            action: { label: '去登录', onClick: () => context.navigate('login', { redirect: 'profile' }) },
        }));
        return;
    }

    replace(host, loadingBlock(3));
    let notify = { exhibitionReminder: true, registrationUpdates: true, granted: true };
    try {
        notify = await call('notify.preferences');
    } catch (ignored) {
        // 通知设置不可用时保留默认值
    }

    render(notify);

    function render(preferences) {
        const user = state.user;
        replace(host, [
            el('div', { class: 'card' }, [
                el('div', { class: 'row', 'data-gap': 'md' }, [
                    el('span', { class: 'avatar', text: (user.nickname || '用').slice(0, 1), 'aria-hidden': 'true' }),
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: user.nickname || user.username }),
                        el('span', { class: 'row-meta', text: `${user.roleLabel} · ${user.status || '正常'}` }),
                        el('span', { class: 'row-meta truncate', text: user.email || '未填写邮箱' }),
                    ]),
                    el('button', {
                        class: 'pill',
                        type: 'button',
                        text: '编辑',
                        onclick: () => openEditor(),
                    }),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '个人简介' }),
                el('p', { class: 'row-meta', text: user.bio || '还没有填写简介，点击“编辑”补充你的关注方向。' }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    infoRow('联系方式', user.contact || '未填写'),
                    infoRow('社交账号', user.socialMedia || '未填写'),
                ]),
            ]),
            el('div', { class: 'list', 'data-gap': 'sm' }, [
                menuRow('账号设置', '昵称、邮箱与联系方式', 'edit', () => openEditor()),
                menuRow('隐私策略', user.showRegistrations ? '当前：展示我的报名' : '当前：不展示我的报名', 'lock', () => togglePublicPolicy()),
                menuRow('用户公开页', '查看他人看到的资料', 'user', () => context.navigate('user-public', { nickname: user.nickname || user.username })),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '通知与提醒' }),
                switchRow({
                    id: 'notify-reminder',
                    label: '展会开始前一天提醒',
                    description: '在展会开展前一天发送通知',
                    checked: preferences.exhibitionReminder,
                    onChange: (value) => savePreferences({ exhibitionReminder: value }),
                }),
                switchRow({
                    id: 'notify-status',
                    label: '报名状态变化提醒',
                    description: '审核通过或拒绝时通知我',
                    checked: preferences.registrationUpdates,
                    onChange: (value) => savePreferences({ registrationUpdates: value }),
                }),
                preferences.granted
                    ? null
                    : el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => requestNotification(),
                    }, ['开启系统通知权限']),
            ]),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => logout(),
            }, ['退出登录']),
        ]);
    }

    function infoRow(label, value) {
        return el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: label }),
            el('span', { class: 'strong truncate', text: value }),
        ]);
    }

    function menuRow(title, meta, iconName, onClick) {
        return el('button', {
            class: 'row-card',
            type: 'button',
            dataset: { pressable: 'true' },
            onclick: onClick,
        }, [
            el('span', { class: 'row-copy' }, [
                el('strong', { class: 'row-title', text: title }),
                el('span', { class: 'row-meta', text: meta }),
            ]),
            el('span', { class: 'dim', 'aria-hidden': 'true', text: '›' }),
        ]);
    }

    async function savePreferences(patch) {
        try {
            const updated = await call('notify.savePreferences', patch);
            Object.assign(notify, updated || {});
            toast('通知设置已更新', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function requestNotification() {
        try {
            const granted = await call('notify.requestPermission');
            notify.granted = granted === true;
            toast(granted ? '已开启通知权限' : '未获得通知权限', granted ? 'success' : 'error');
            render(notify);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function openEditor() {
        const user = state.user;
        const nickname = el('input', { class: 'input', id: 'profile-nickname', value: user.nickname || user.username });
        const email = el('input', { class: 'input', id: 'profile-email', type: 'email', value: user.email || '' });
        const bio = el('textarea', { class: 'textarea', id: 'profile-bio' });
        bio.value = user.bio || '';
        const contact = el('input', { class: 'input', id: 'profile-contact', value: user.contact || '' });
        const social = el('input', { class: 'input', id: 'profile-social', value: user.socialMedia || '' });
        const showRegistrations = el('input', { type: 'checkbox', id: 'profile-show' });
        showRegistrations.checked = Boolean(user.showRegistrations);

        openSheet({
            title: '编辑资料',
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    field('昵称', nickname),
                    field('邮箱', email),
                    field('个人简介', bio),
                    field('联系方式', contact),
                    field('社交账号', social),
                    el('label', { class: 'check-label', for: 'profile-show' }, [showRegistrations, '在公开页展示我的报名记录']),
                ]),
            ],
            actions: [
                { label: '取消', onClick: (close) => close() },
                {
                    label: '保存',
                    variant: 'primary',
                    onClick: async (close) => {
                        try {
                            const result = await call('profile.save', {
                                nickname: nickname.value.trim(),
                                email: email.value.trim(),
                                bio: bio.value.trim(),
                                contact: contact.value.trim(),
                                socialMedia: social.value.trim(),
                                showRegistrations: showRegistrations.checked,
                            });
                            if (!result?.ok) {
                                toast(result?.error || '保存失败', 'error');
                                return;
                            }
                            Object.assign(state.user, result.user || {});
                            close();
                            toast('资料已保存', 'success');
                            context.refresh();
                        } catch (error) {
                            toast(error.message, 'error');
                        }
                    },
                },
            ],
        });
    }

    function togglePublicPolicy() {
        const next = !state.user.showRegistrations;
        call('profile.save', {
            nickname: state.user.nickname,
            email: state.user.email,
            bio: state.user.bio,
            contact: state.user.contact,
            socialMedia: state.user.socialMedia,
            showRegistrations: next,
        }).then((result) => {
            if (result?.ok) {
                Object.assign(state.user, result.user || {});
                toast(next ? '已开启报名展示' : '已关闭报名展示', 'success');
                context.refresh();
            } else {
                toast(result?.error || '设置失败', 'error');
            }
        }).catch((error) => toast(error.message, 'error'));
    }

    function logout() {
        call('auth.logout').then(async () => {
            await refreshUser();
            toast('已退出登录');
            context.navigate('login', {}, { replace: true });
        }).catch((error) => toast(error.message, 'error'));
    }

    function field(label, control) {
        return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control]);
    }
}
