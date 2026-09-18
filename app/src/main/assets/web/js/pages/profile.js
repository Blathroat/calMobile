import { t } from '../core/strings.js';
/**
 * 屏幕 09 · 个人主页
 * 线框：newUI/remaining-ui.html #screen-profile
 * 业务：账号资料、头像、通知与提醒，以及个人偏好里的应用配色。
 *
 * 服务器级设置（启动公告、展会分类、审核策略、媒体与上传限制、字符数上限）
 * 已迁回「管理-设置」，普通用户在这里只会看到属于自己的通知开关与配色。
 */

import { call, state, applyTheme, applySettings, applyMode } from '../core/bridge.js';
import { authApi, profileApi, settingsApi } from '../core/api.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { avatarNode, loadingBlock, openAvatarCropper, openSheet, segmented, smallCta, stateBlock, switchRow, toast } from '../ui/components.js';
import { el, append, replace } from '../core/dom.js';
import { fieldValidator, validateAll, limit, passwordRule, matchRule } from '../core/validate.js';

export async function profilePage(context) {
    const host = el('div', { class: 'stack' });
    scaffold({
        title: t('s_1kzh3gd'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'profile' }),
        children: [host],
    });

    if (!state.user.loggedIn) {
        replace(host, stateBlock({
            iconName: 'user',
            title: t('s_1h1rste'),
            description: t('s_1b7h1x'),
            action: { label: t('s_533bde'), onClick: () => context.navigate('login', { redirect: 'profile' }) },
        }));
        return;
    }

    const isAdmin = state.user.can?.admin === true;

    // 通知偏好与个人配色并行拉取，任一失败都保留可用默认值。
    // 命中缓存就先出一屏（切页面因此不闪骨架屏），数据回来再按差异决定是否重绘。
    //
    // 注意 `granted`：后端只保存用户开关，系统通知权限只有设备知道，
    // 因此按钮的显隐看 `state.capabilities.notifications`（bootstrap 时由 `ui.sync` 带回）。
    const warmNotify = profileApi.notifications.peek();
    const warmSettings = settingsApi.get.peek();
    const warmReady = warmNotify !== undefined || warmSettings !== undefined;

    const DEFAULT_NOTIFY = { exhibitionReminder: true, registrationUpdates: true, granted: true };
    let notify = warmNotify || DEFAULT_NOTIFY;
    let settings = warmSettings || null;
    if (settings) {
        applySettings(settings);
    }
    let themeIndex = settings?.theme?.index ?? state.theme.index ?? 0;

    if (warmReady) {
        render();
    } else {
        replace(host, loadingBlock(3));
    }

    const [notifyResult, settingsResult] = await Promise.allSettled([
        profileApi.notifications(),
        settingsApi.get(),
    ]);

    const freshNotify = notifyResult.status === 'fulfilled' && notifyResult.value
        ? notifyResult.value
        : DEFAULT_NOTIFY;
    const freshSettings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
    // 缓存里那一份和拉回来的一样时不必重绘：重绘会重建开关与色板，让刚播的入场动画重放。
    const changed = !warmReady
        || JSON.stringify(freshNotify) !== JSON.stringify(notify)
        || JSON.stringify(freshSettings) !== JSON.stringify(settings);

    notify = freshNotify;
    settings = freshSettings;
    if (settings) {
        applySettings(settings);
    }
    themeIndex = settings?.theme?.index ?? state.theme.index ?? 0;

    if (changed) {
        render();
    }

    function render() {
        const user = state.user;
        const blocks = [
            identityCard(user),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_ml9unw') }),
                el('p', { class: 'row-meta', text: user.bio || t('s_17mtsm3') }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    infoRow(t('s_11ftk7j'), user.region || t('s_15h5nhd')),
                    infoRow(t('s_1hnvqec'), user.socialMedia || t('s_15h5nhd')),
                ]),
            ]),
            privacyCard(user),
            el('div', { class: 'list', 'data-gap': 'sm' }, [
                menuRow(t('s_1y0imfq'), t('s_16sgm5m'), () => openEditor()),
                menuRow(t('s_1pt7oo1'), `至少 ${passwordRule().min} 个字符`, () => openPasswordSheet()),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_1vmubx9') }),
                switchRow({
                    id: 'notify-reminder',
                    label: t('s_1f8zcmv'),
                    description: t('s_kiu9q'),
                    checked: notify.exhibitionReminder,
                    onChange: (value) => savePreferences({ exhibitionReminder: value }),
                }),
                switchRow({
                    id: 'notify-status',
                    label: t('s_fz8qsa'),
                    description: t('s_1xohyb0'),
                    checked: notify.registrationUpdates,
                    onChange: (value) => savePreferences({ registrationUpdates: value }),
                }),
                // 系统通知权限只有设备知道：后端返回的 granted 只表示服务器侧开关可用，
                // 真正的授权状态由原生在 bootstrap 时通过 ui.sync 带回。
                notificationGranted()
                    ? null
                    : el('button', {
                        class: 'cta ghost',
                        type: 'button',
                        onclick: () => requestNotification(),
                    }, [t('s_1splm64')]),
                isAdmin ? themeBlock() : null,
            ]),
            appearanceCard(),
        ];

        if (isAdmin) {
            blocks.push(el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('button', {
                    class: 'cta',
                    type: 'button',
                    onclick: () => saveTheme(),
                }, [t('s_apw50v')]),
                el('p', {
                    class: 'field-hint',
                    style: { textAlign: 'center' },
                    text: t('s_fp6vpq'),
                }),
            ]));
        }

        blocks.push(el('button', {
            class: 'cta ghost',
            type: 'button',
            onclick: () => logout(),
        }, [t('s_12hokt7')]));

        replace(host, blocks);
    }

    function identityCard(user) {
        const avatar = avatarNode({ src: user.avatar, name: user.nickname || user.username, className: 'avatar avatar-lg' });
        return el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                avatar,
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: user.nickname || user.username }),
                    el('span', { class: 'row-meta', text: `${user.roleLabel} · ${user.status || t('s_tt5vxa')}` }),
                    el('span', { class: 'row-meta truncate', text: user.email || t('s_1hhb6bo') }),
                ]),
                el('button', {
                    class: 'pill',
                    type: 'button',
                    text: t('s_qreyeg'),
                    onclick: () => openEditor(),
                }),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallCta(t('s_onix0y'), () => pickAvatar()),
                user.avatar
                    ? smallCta(t('s_1no1khr'), () => saveAvatar(''))
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
            el('span', { class: 'section-label', text: t('s_4odn3m') }),
            palette,
            el('p', { class: 'field-hint', text: t('s_aky3i4') }),
        ]);
    }

    /**
     * 深色模式：跟随系统 / 浅色 / 深色三选一，切换立即生效并保存在本机。
     * 保存失败（例如尚未登录）只提示一次，本次会话的外观仍然保留。
     */
    function appearanceCard() {
        const card = el('div', { class: 'card' });
        const hint = el('p', { class: 'field-hint', text: modeHint() });
        const seg = segmented({
            label: t('s_1ghvdtm'),
            value: state.ui.mode,
            items: [
                { value: 'auto', label: t('s_1e3rp8l') },
                { value: 'light', label: t('s_4wwqgm') },
                { value: 'dark', label: t('s_bsz4ru') },
            ],
            onChange: (value) => changeMode(value),
        });
        replace(card, [
            el('span', { class: 'section-label', text: t('s_1ghvdtm') }),
            seg,
            hint,
        ]);
        return card;
    }

    function modeHint() {
        if (state.ui.mode === 'auto') {
            return t('s_1mlidnr');
        }
        return state.ui.mode === 'dark' ? t('s_1ylfcsc') : t('s_141p70w');
    }

    async function changeMode(value) {
        applyMode(value);
        render();
        try {
            const result = await settingsApi.saveUiMode(value);
            if (result?.mode) {
                applyMode(result.mode);
                render();
            }
        } catch (error) {
            toast(`外观已切换，但未能保存：${error.message}`, 'error');
        }
    }

    /**
     * 隐私设置：是否在公开页展示自己的报名记录。
     * <p>
     * 这条开关此前只在保存资料时透传 `state.user.showRegistrations`（恒为 false），
     * 界面上没有任何入口，于是「公开」分支永远走不到。这里补上开关；
     * 管理员查看公开页不受该设置影响（见 AdminActions.publicProfile）。
     */
    function privacyCard(user) {
        return el('div', { class: 'card' }, [
            el('span', { class: 'section-label', text: t('s_lh9gvq') }),
            switchRow({
                id: 'privacy-registrations',
                label: t('s_1utpn11'),
                description: t('s_1wgtu4f'),
                checked: user.showRegistrations === true,
                onChange: (value) => savePrivacy(value),
            }),
            el('p', {
                class: 'field-hint',
                text: user.showRegistrations === true ? t('s_1kyf8ic') : t('s_413sl5'),
            }),
        ]);
    }

    /** 隐私开关立即生效：失败时回滚界面状态，避免看起来已保存。 */
    async function savePrivacy(value) {
        const previous = state.user.showRegistrations === true;
        state.user.showRegistrations = value;
        try {
            const saved = await profileApi.save({
                nickname: state.user.nickname || '',
                email: state.user.email || '',
                bio: state.user.bio || '',
                region: state.user.region || '',
                socialMedia: state.user.socialMedia || '',
                avatar: state.user.avatar || '',
                showRegistrations: value,
            });
            if (!saved?.ok) {
                state.user.showRegistrations = previous;
                toast(saved?.error || t('s_1q9u8le'), 'error');
            } else {
                Object.assign(state.user, saved.user || {});
                toast(value ? t('s_92i7f7') : t('s_dn42iy'), 'success');
            }
        } catch (error) {
            state.user.showRegistrations = previous;
            toast(error.message, 'error');
        }
        render();
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

    // ── 头像：选择 → 圆形裁剪 → 落盘换成短 URL ────────────────────

    async function pickAvatar() {
        try {
            const picked = await call('media.pickImage');
            const source = picked?.dataUrl;
            if (!source) {
                toast(t('s_1dc9o49'), 'error');
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
            if (String(error.message).includes(t('s_1589w37'))) {
                return;
            }
            toast(error.message, 'error');
        }
    }

    async function storeAvatar(dataUrl) {
        const stored = await call('media.store', { dataUrl, kind: 'avatar' });
        if (!stored?.ok || !stored.url) {
            toast(stored?.error || t('s_5iff2f'), 'error');
            return;
        }
        await saveAvatar(stored.url);
    }

    async function saveAvatar(url) {
        try {
            const result = await profileApi.save({
                nickname: state.user.nickname || state.user.username,
                email: state.user.email || '',
                bio: state.user.bio || '',
                region: state.user.region || '',
                socialMedia: state.user.socialMedia || '',
                avatar: url,
                showRegistrations: state.user.showRegistrations === true,
            });
            if (!result?.ok) {
                toast(result?.error || t('s_5iff2f'), 'error');
                return;
            }
            Object.assign(state.user, result.user || {});
            toast(url ? t('s_3rxr06') : t('s_14ol5jh'), 'success');
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function saveTheme() {
        try {
            const result = await settingsApi.save({ themeIndex });
            if (!result?.ok) {
                toast(t('s_1q9u8le'), 'error');
                return;
            }
            settings = result.settings;
            applySettings(settings);
            themeIndex = settings?.theme?.index ?? themeIndex;
            toast(t('s_145fdbt'), 'success');
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function savePreferences(patch) {
        try {
            // 写接口统一返回 { ok, error, ... }，通知偏好放在 notify 里。
            const result = await profileApi.saveNotifications(patch);
            Object.assign(notify, result?.notify || {});
            toast(t('s_15wm4xy'), 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function requestNotification() {
        try {
            const granted = await call('notify.requestPermission');
            notify.granted = granted === true;
            // 拿到结果后同步到设备能力，按钮的显隐以它为准（见 notificationGranted）。
            state.capabilities.notifications = granted === true;
            toast(granted ? t('s_j5c9oy') : t('s_1ya7561'), granted ? 'success' : 'error');
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    /** 设备是否已拿到系统通知权限；没有桥接（浏览器预览）时退回后端的值。 */
    function notificationGranted() {
        return typeof state.capabilities.notifications === 'boolean'
            ? state.capabilities.notifications
            : notify.granted;
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
            placeholder: t('s_132uhjs'),
        });
        const social = el('input', {
            class: 'input',
            id: 'profile-social',
            value: user.socialMedia || '',
            placeholder: '例如：微博 / 微信公众号',
        });

        const validators = [
            fieldValidator({ control: nickname, label: t('s_1c2rfxc'), required: true, max: limit('nickname', 20) }),
            fieldValidator({
                control: email,
                label: t('s_185tvls'),
                max: 60,
                pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
                patternMessage: t('s_1u3yg0h'),
            }),
            fieldValidator({ control: bio, label: t('s_ml9unw'), max: limit('bio', 200) }),
            fieldValidator({ control: region, label: t('s_11ftk7j'), max: limit('region', 40) }),
            fieldValidator({ control: social, label: t('s_1hnvqec'), max: 40 }),
        ];
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });

        openSheet({
            title: t('s_1sq2bvr'),
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    field(t('s_1c2rfxc'), nickname),
                    field(t('s_185tvls'), email),
                    field(t('s_ml9unw'), bio),
                    field(t('s_11ftk7j'), region),
                    field(t('s_1hnvqec'), social),
                    errorBox,
                ]),
            ],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_1c3mapc'),
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
                            const saved = await profileApi.save({
                                nickname: nickname.value.trim(),
                                email: email.value.trim(),
                                bio: bio.value.trim(),
                                region: region.value.trim(),
                                socialMedia: social.value.trim(),
                                avatar: user.avatar || '',
                                showRegistrations: user.showRegistrations === true,
                            });
                            if (!saved?.ok) {
                                errorBox.textContent = saved?.error || t('s_1q9u8le');
                                errorBox.hidden = false;
                                return;
                            }
                            Object.assign(state.user, saved.user || {});
                            close();
                            toast(t('s_i86pw9'), 'success');
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
            fieldValidator({ control: current, label: t('s_1q7kb1c'), required: true, max: rule.max }),
            fieldValidator({
                control: next,
                label: t('s_9sfqbi'),
                required: true,
                min: rule.min,
                max: rule.max,
                custom: matchRule(next, confirm),
            }),
            fieldValidator({ control: confirm, label: t('s_1b253gw'), required: true, max: rule.max }),
        ];

        openSheet({
            title: t('s_1pt7oo1'),
            size: 'full',
            content: [
                el('div', { class: 'form' }, [
                    field(t('s_1q7kb1c'), current),
                    field(`新密码（${rule.min}–${rule.max} 个字符）`, next),
                    field(t('s_1b253gw'), confirm),
                    errorBox,
                ]),
                el('p', { class: 'field-hint', text: t('s_faylcn') }),
            ],
            actions: [
                { label: t('s_1589w37'), onClick: (close) => close() },
                {
                    label: t('s_13ekny6'),
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
                            const saved = await profileApi.changePassword({
                                currentPassword: current.value,
                                newPassword: next.value,
                                confirmPassword: confirm.value,
                            });
                            if (!saved?.ok) {
                                errorBox.textContent = saved?.error || t('s_a7qley');
                                errorBox.hidden = false;
                                return;
                            }
                            close();
                            toast(saved.note || t('s_4hjltm'), 'success');
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
        authApi.logout().then(() => {
            Object.assign(state.user, {
                loggedIn: false,
                guest: true,
                role: 'guest',
                roleLabel: t('s_h6o1xg'),
                username: '',
                nickname: '',
                avatar: '',
                can: {},
            });
            toast(t('s_pdyp8r'));
            context.navigate('login', {}, { replace: true });
        }).catch((error) => toast(error.message, 'error'));
    }

    function field(label, control) {
        return el('div', { class: 'field' }, [el('label', { for: control.id, text: label }), control]);
    }
}
