/**
 * 屏幕 09 · 个人主页
 * 线框：newUI/remaining-ui.html #screen-profile
 * 业务：账号资料、通知与提醒，以及原先在“管理-设置”中的系统设置
 * （应用配色、启动公告、展会分类、审核策略、富文本媒体限制）。
 */

import { call, state, applyTheme } from '../core/bridge.js';
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

    // 通知偏好与系统设置并行拉取，任一失败都保留可用默认值。
    const [notifyResult, settingsResult] = await Promise.allSettled([
        call('notify.preferences'),
        state.user.can?.admin ? call('settings.get') : Promise.resolve(null),
    ]);

    const notify = notifyResult.status === 'fulfilled' && notifyResult.value
        ? notifyResult.value
        : { exhibitionReminder: true, registrationUpdates: true, granted: true };
    let settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
    let themeIndex = settings?.theme?.index ?? state.theme.index ?? 0;
    let announcementEnabled = Boolean(settings?.announcement?.enabled ?? state.announcement.enabled);
    let canRevise = Boolean(settings?.review?.canRevise ?? state.review.canRevise);

    const isAdmin = state.user.can?.admin === true;
    const announcementText = textarea('settings-announcement', settings?.announcement?.text || state.announcement.text || '');
    const categoriesText = textarea('settings-categories', (settings?.categories || state.categories || []).join('\n'));
    const imageCount = numberInput('settings-image-count', settings?.media?.imageCount ?? state.media.imageCount ?? 8);
    const imageSize = numberInput('settings-image-size', settings?.media?.imageSizeMb ?? state.media.imageSizeMb ?? 10);
    const videoCount = numberInput('settings-video-count', settings?.media?.videoCount ?? state.media.videoCount ?? 2);

    render();

    function render() {
        const user = state.user;
        const blocks = [
            identityCard(user),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '个人简介' }),
                el('p', { class: 'row-meta', text: user.bio || '还没有填写简介，点击“编辑”补充你的关注方向。' }),
                el('div', { class: 'stack', 'data-gap': 'sm' }, [
                    infoRow('联系方式', user.contact || '未填写'),
                    infoRow('社交账号', user.socialMedia || '未填写'),
                ]),
            ]),
            el('div', { class: 'list', 'data-gap': 'sm' }, [
                menuRow('账号设置', '昵称、邮箱与联系方式', () => openEditor()),
                menuRow('用户公开页', '查看他人看到的资料', () => context.navigate('user-public', { nickname: user.nickname || user.username })),
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
                isAdmin ? adminSettingsBlocks() : null,
            ]),
        ];

        if (isAdmin) {
            blocks.push(el('div', { class: 'stack', 'data-gap': 'sm' }, [
                el('button', {
                    class: 'cta',
                    type: 'button',
                    onclick: () => saveSettings(),
                }, ['保存设置']),
                el('p', {
                    class: 'field-hint',
                    style: { textAlign: 'center' },
                    text: '配色与公告保存后立即生效，媒体限制作用于富文本编辑器。',
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
        return el('div', { class: 'card' }, [
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
        ]);
    }

    /** 管理员专属：原先“管理-设置”中的全部内容。 */
    function adminSettingsBlocks() {
        const colors = settings?.theme?.colors || state.theme.colors || [];
        const palette = el('div', { class: 'cluster' });
        colors.forEach((color, index) => {
            append(palette, el('button', {
                type: 'button',
                'aria-label': `配色 ${index + 1} ${color}`,
                'aria-pressed': index === themeIndex ? 'true' : 'false',
                title: color,
                style: {
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: color,
                    border: index === themeIndex ? '3px solid var(--ink)' : '1px solid var(--stroke)',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: '700',
                },
                onclick: () => {
                    themeIndex = index;
                    render();
                },
            }, [color.replace('#', '')]));
        });

        return el('div', { class: 'stack' }, [
            el('hr', { class: 'divider' }),
            el('span', { class: 'section-label', text: '应用配色' }),
            palette,
            el('p', { class: 'field-hint', text: '配色作用于强调色、状态标签与系统栏，保存后立即生效。' }),
            el('span', { class: 'section-label', text: '进入应用时的公告' }),
            announcementText,
            switchRow({
                id: 'settings-announcement-enabled',
                label: '进入应用时显示公告',
                description: '用户打开首页时展示一次',
                checked: announcementEnabled,
                onChange: (value) => {
                    announcementEnabled = value;
                },
            }),
            el('span', { class: 'section-label', text: '展会分类管理' }),
            categoriesText,
            el('p', { class: 'field-hint', text: '每行一个分类，用于展商填写与搜索筛选。' }),
            el('span', { class: 'section-label', text: '审核策略' }),
            switchRow({
                id: 'settings-revise',
                label: '允许修改已通过或已拒绝的报名',
                description: '开启后展商可以重新审核已处理的报名',
                checked: canRevise,
                onChange: (value) => {
                    canRevise = value;
                },
            }),
            el('span', { class: 'section-label', text: '富文本媒体限制' }),
            numberField('每篇图片数量上限', imageCount, '张'),
            numberField('单张图片大小', imageSize, 'MB'),
            numberField('视频数量上限', videoCount, '个'),
            el('div', { class: 'notice' }, [
                el('strong', { text: '设置范围明确' }),
                el('span', { text: '当前作用于富文本编辑器的上传提示与数量校验，媒体文件仍保存在设备本地。' }),
            ]),
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

    function numberField(label, control, suffix) {
        return el('div', { class: 'field' }, [
            el('label', { for: control.id, text: label }),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                control,
                el('span', { class: 'row-meta', text: suffix }),
            ]),
        ]);
    }

    function textarea(id, value) {
        const control = el('textarea', { class: 'textarea', id, rows: 3 });
        control.value = value || '';
        return control;
    }

    function numberInput(id, value) {
        return el('input', {
            class: 'input',
            id,
            type: 'number',
            min: '0',
            value: String(value ?? 0),
            inputmode: 'numeric',
        });
    }

    async function saveSettings() {
        try {
            const result = await call('settings.save', {
                themeIndex,
                announcement: announcementText.value.trim(),
                announcementEnabled,
                categories: categoriesText.value.split('\n').map((item) => item.trim()).filter(Boolean),
                canRevise,
                imageCount: Number(imageCount.value) || 0,
                imageSizeMb: Number(imageSize.value) || 0,
                videoCount: Number(videoCount.value) || 0,
            });
            if (!result?.ok) {
                toast('保存失败', 'error');
                return;
            }
            settings = result.settings;
            Object.assign(state.theme, settings.theme || {});
            Object.assign(state.announcement, settings.announcement || {});
            Object.assign(state.media, settings.media || {});
            Object.assign(state.review, settings.review || {});
            state.categories = settings.categories || state.categories;
            applyTheme();
            toast('设置已保存', 'success');
            context.refresh();
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

    function openEditor() {
        const user = state.user;
        const nickname = el('input', { class: 'input', id: 'profile-nickname', value: user.nickname || user.username });
        const email = el('input', { class: 'input', id: 'profile-email', type: 'email', value: user.email || '' });
        const bio = el('textarea', { class: 'textarea', id: 'profile-bio' });
        bio.value = user.bio || '';
        const contact = el('input', { class: 'input', id: 'profile-contact', value: user.contact || '' });
        const social = el('input', { class: 'input', id: 'profile-social', value: user.socialMedia || '' });

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
                                showRegistrations: user.showRegistrations === true,
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

    function logout() {
        call('auth.logout').then(() => {
            Object.assign(state.user, {
                loggedIn: false,
                guest: true,
                role: 'guest',
                roleLabel: '访客',
                username: '',
                nickname: '',
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
