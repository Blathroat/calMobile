/**
 * 屏幕 09 · 个人主页
 * 线框：newUI/remaining-ui.html #screen-profile
 * 业务：账号资料、头像、通知与提醒，以及个人偏好里的应用配色。
 *
 * 服务器级设置（启动公告、展会分类、审核策略、媒体与上传限制、字符数上限）
 * 已迁回「管理-设置」，普通用户在这里只会看到属于自己的通知开关与配色。
 */

import { call, state, applyTheme, applySettings } from '../core/bridge.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import {
    avatarNode,
    openAvatarCropper,
    loadingBlock,
    stateBlock,
    switchRow,
    toast,
    openSheet,
} from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';
import { fieldValidator, validateAll, limit, passwordRule, matchRule } from '../core/validate.js';

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

    // 通知偏好与个人配色并行拉取，任一失败都保留可用默认值。
    const [notifyResult, settingsResult] = await Promise.allSettled([
        call('notify.preferences'),
        call('settings.get'),
    ]);

    const notify = notifyResult.status === 'fulfilled' && notifyResult.value
        ? notifyResult.value
        : { exhibitionReminder: true, registrationUpdates: true, granted: true };
    let settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
    if (settings) {
        applySettings(settings);
    }
    let themeIndex = settings?.theme?.index ?? state.theme.index ?? 0;

    const isAdmin = state.user.can?.admin === true;

    render();

    function render() {
        const user = state.user;
        const blocks = [
            identityCard(user),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '个人简介' }),
                el('p', { class: 'row-meta', text: user.bio || '还没有填写简介，点击“编辑”补充你的关注方向。' }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    infoRow('地区', user.region || '未填写'),
                    infoRow('社交账号', user.socialMedia || '未填写'),
                ]),
            ]),
            el('div', { class: 'list', 'data-gap': 'sm' }, [
                menuRow('账号设置', '昵称、邮箱与所在地区', () => openEditor()),
                menuRow('修改密码', `至少 ${passwordRule().min} 个字符`, () => openPasswordSheet()),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '设置' }),
                switchRow({
                    id: 'notify-reminder',
                    label: '展会开始前一天提醒',
                    description: '在展会开展前一天发送通知',
                    checked: notify.exhibitionReminder,
                    onChange: (value) => savePreferences({ exhibitionReminder: value }),
                }),
                switchRow({
                    id: 'notify-status',
                    label: '报名状态变化提醒',
                    description: '审核通过或拒绝时通知我',
                    checked: notify.registrationUpdates,
                    onChange: (value) => savePreferences({ registrationUpdates: value }),
                }),
                notify.granted
                    ? null
                    : el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => requestNotification(),
                    }, ['开启系统通知权限']),
                isAdmin ? themeBlock() : null,
            ]),
        ];

        if (isAdmin) {
            blocks.push(el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('button', {
                    class: 'cta',
                    type: 'button',
                    onclick: () => saveTheme(),
                }, ['保存配色']),
                el('p', {
                    class: 'field-hint',
                    style: { textAlign: 'center' },
                    text: '配色保存后立即生效，并作用于导航、分段控件与选中态。',
                }),
            ]));
        }

        blocks.push(el('button', {
            class: 'cta ghost',
            type: 'button',
            onclick: () => logout(),
        }, ['退出登录']));

        replace(host, blocks);
    }

    function identityCard(user) {
        const avatar = avatarNode({ src: user.avatar, name: user.nickname || user.username, className: 'avatar avatar-lg' });
        return el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                avatar,
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
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallButton('上传头像', () => pickAvatar()),
                user.avatar
                    ? smallButton('移除头像', () => saveAvatar(''))
                    : null,
            ]),
        ]);
    }

    /** 应用配色：管理员可调整，保存后对所有页面生效。 */
    function themeBlock() {
        const colors = settings?.theme?.colors || state.theme.colors || [];
        const palette = el('div', { class: 'cluster' });
        colors.forEach((color, index) => {
            append(palette, el('button', {
                type: 'button',
                class: 'swatch',
                'aria-label': `配色 ${index + 1} ${color}`,
                'aria-pressed': index === themeIndex ? 'true' : 'false',
                title: color,
                style: { background: color },
                onclick: () => {
                    themeIndex = index;
                    // 立即预览：先把选中色写进 CSS 变量，再重绘选中环。
                    state.theme.index = index;
                    state.theme.colors = colors;
                    applyTheme();
                    render();
                },
            }, [color.replace('#', '')]));
        });

        return el('div', { class: 'stack' }, [
            el('hr', { class: 'divider' }),
            el('span', { class: 'section-label', text: '应用配色' }),
            palette,
            el('p', { class: 'field-hint', text: '配色作用于强调色、选中态与系统栏，保存后立即生效。' }),
        ]);
    }

    function infoRow(label, value) {
        return el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: label }),
            el('span', { class: 'strong truncate', text: value }),
        ]);
    }

    function menuRow(title, meta, onClick) {
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

    function smallButton(label, onClick) {
        return el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)', flex: '1 1 0' },
            onclick: onClick,
        }, [label]);
    }

    // ── 头像：选择 → 圆形裁剪 → 落盘换成短 URL ────────────────────

    async function pickAvatar() {
        try {
            const picked = await call('media.pickImage');
            const source = picked?.dataUrl;
            if (!source) {
                toast('未能读取所选图片', 'error');
                return;
            }
            openAvatarCropper({
                source,
                onDone: async (dataUrl) => {
                    await storeAvatar(dataUrl);
                },
                onError: (error) => toast(error.message, 'error'),
            });
        } catch (error) {
            if (String(error.message).includes('取消')) {
                return;
            }
            toast(error.message, 'error');
        }
    }

    async function storeAvatar(dataUrl) {
        const stored = await call('media.store', { dataUrl, kind: 'avatar' });
        if (!stored?.ok || !stored.url) {
            toast(stored?.error || '头像保存失败', 'error');
            return;
        }
        await saveAvatar(stored.url);
    }

    async function saveAvatar(url) {
        try {
            const result = await call('profile.save', {
                nickname: state.user.nickname || state.user.username,
                email: state.user.email || '',
                bio: state.user.bio || '',
                region: state.user.region || '',
                socialMedia: state.user.socialMedia || '',
                avatar: url,
                showRegistrations: state.user.showRegistrations === true,
            });
            if (!result?.ok) {
                toast(result?.error || '头像保存失败', 'error');
                return;
            }
            Object.assign(state.user, result.user || {});
            toast(url ? '头像已更新' : '头像已移除', 'success');
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function saveTheme() {
        try {
            const result = await call('settings.save', { themeIndex });
            if (!result?.ok) {
                toast('保存失败', 'error');
                return;
            }
            settings = result.settings;
            applySettings(settings);
            themeIndex = settings?.theme?.index ?? themeIndex;
            toast('配色已保存', 'success');
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
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
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    // ── 编辑资料 ───────────────────────────────────────────────────

    function openEditor() {
        const user = state.user;
        const nickname = el('input', { class: 'input', id: 'profile-nickname', value: user.nickname || user.username });
        const email = el('input', { class: 'input', id: 'profile-email', type: 'email', value: user.email || '' });
        const bio = el('textarea', { class: 'textarea', id: 'profile-bio', rows: 3 });
        bio.value = user.bio || '';
        const region = el('input', {
            class: 'input',
            id: 'profile-region',
            value: user.region || '',
            placeholder: '例如：上海 · 浦东新区',
        });
        const social = el('input', {
            class: 'input',
            id: 'profile-social',
            value: user.socialMedia || '',
            placeholder: '例如：微博 / 微信公众号',
        });

        const validators = [
            fieldValidator({ control: nickname, label: '昵称', required: true, max: limit('nickname', 20) }),
            fieldValidator({
                control: email,
                label: '邮箱',
                max: 60,
                pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
                patternMessage: '邮箱格式不正确',
            }),
            fieldValidator({ control: bio, label: '个人简介', max: limit('bio', 200) }),
            fieldValidator({ control: region, label: '地区', max: limit('region', 40) }),
            fieldValidator({ control: social, label: '社交账号', max: 40 }),
        ];
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });

        openSheet({
            title: '编辑资料',
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    field('昵称', nickname),
                    field('邮箱', email),
                    field('个人简介', bio),
                    field('地区', region),
                    field('社交账号', social),
                    errorBox,
                ]),
            ],
            actions: [
                { label: '取消', onClick: (close) => close() },
                {
                    label: '保存',
                    variant: 'primary',
                    onClick: async (close) => {
                        const result = validateAll(validators);
                        if (!result.ok) {
                            errorBox.textContent = result.message;
                            errorBox.hidden = false;
                            result.validator.focus();
                            return;
                        }
                        try {
                            const saved = await call('profile.save', {
                                nickname: nickname.value.trim(),
                                email: email.value.trim(),
                                bio: bio.value.trim(),
                                region: region.value.trim(),
                                socialMedia: social.value.trim(),
                                avatar: user.avatar || '',
                                showRegistrations: user.showRegistrations === true,
                            });
                            if (!saved?.ok) {
                                errorBox.textContent = saved?.error || '保存失败';
                                errorBox.hidden = false;
                                return;
                            }
                            Object.assign(state.user, saved.user || {});
                            close();
                            toast('资料已保存', 'success');
                            render();
                        } catch (error) {
                            errorBox.textContent = error.message;
                            errorBox.hidden = false;
                        }
                    },
                },
            ],
        });
    }

    function openPasswordSheet() {
        const rule = passwordRule();
        const current = el('input', { class: 'input', id: 'password-current', type: 'password', autocomplete: 'current-password' });
        const next = el('input', { class: 'input', id: 'password-next', type: 'password', autocomplete: 'new-password' });
        const confirm = el('input', { class: 'input', id: 'password-confirm', type: 'password', autocomplete: 'new-password' });
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });

        const validators = [
            fieldValidator({ control: current, label: '当前密码', required: true, max: rule.max }),
            fieldValidator({
                control: next,
                label: '新密码',
                required: true,
                min: rule.min,
                max: rule.max,
                custom: matchRule(next, confirm),
            }),
            fieldValidator({ control: confirm, label: '确认新密码', required: true, max: rule.max }),
        ];

        openSheet({
            title: '修改密码',
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    field('当前密码', current),
                    field(`新密码（${rule.min}–${rule.max} 个字符）`, next),
                    field('确认新密码', confirm),
                    errorBox,
                ]),
                el('p', { class: 'field-hint', text: '演示环境只校验输入格式，不会真的修改密码。' }),
            ],
            actions: [
                { label: '取消', onClick: (close) => close() },
                {
                    label: '确认修改',
                    variant: 'primary',
                    onClick: async (close) => {
                        const result = validateAll(validators);
                        if (!result.ok) {
                            errorBox.textContent = result.message;
                            errorBox.hidden = false;
                            result.validator.focus();
                            return;
                        }
                        try {
                            const saved = await call('profile.password', {
                                currentPassword: current.value,
                                newPassword: next.value,
                                confirmPassword: confirm.value,
                            });
                            if (!saved?.ok) {
                                errorBox.textContent = saved?.error || '修改失败';
                                errorBox.hidden = false;
                                return;
                            }
                            close();
                            toast(saved.note || '密码已更新', 'success');
                        } catch (error) {
                            errorBox.textContent = error.message;
                            errorBox.hidden = false;
                        }
                    },
                },
            ],
        });
    }

    function logout() {
        call('auth.logout').then(() => {
            Object.assign(state.user, {
                loggedIn: false,
                guest: true,
                role: 'guest',
                roleLabel: '访客',
                username: '',
                nickname: '',
                avatar: '',
                can: {},
            });
            toast('已退出登录');
            context.navigate('login', {}, { replace: true });
        }).catch((error) => toast(error.message, 'error'));
    }

    function field(label, control) {
        return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control]);
    }
}
