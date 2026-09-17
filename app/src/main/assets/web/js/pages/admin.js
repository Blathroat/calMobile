import { t } from '../core/strings.js';
/**
 * 屏幕 15 · 管理后台（用户 / 展会 / 设置）
 * 线框：newUI/remaining-ui.html #screen-admin-backend、#screen-admin-settings
 * 业务：AdminUserManager 用户状态管理、ExhibitionManager 展会管理、AppSettings 服务器设置。
 *
 * 展会卡片与展商后台保持一致；搜索、暂停与导出直接内联在本页。
 * 启动公告、展会分类、审核策略、媒体与上传限制、字符数上限都属于服务器设置，
 * 保存后对所有用户生效，因此统一放在「设置」分区，不再有二级页面。
 */

import { call, state, applySettings } from '../core/bridge.js';
import { exhibitions, settingsApi, usersApi } from '../core/api.js';
import { scaffold, tabbar, navItems } from '../core/router.js';
import { confirmSheet, loadErrorBlock, loadingBlock, mediaBox, openSheet, segmented, smallCta, stateBlock, statusTag, statusTone, switchRow, toast } from '../ui/components.js';
import { el, replace, truncate, formatDateWithWeekday } from '../core/dom.js';
import { EXHIBITION_STATUS } from '../core/status.js';
import { fieldValidator, validateAll } from '../core/validate.js';

const USER_STATUSES = [t('s_tt5vxa'), t('s_1am6dte'), t('s_1j1q2yf')];

const TABS = [
    { value: t('s_1in002o'), label: t('s_1in002o') },
    { value: t('s_11cd4ta'), label: t('s_11cd4ta') },
    { value: t('s_1vmubx9'), label: t('s_1vmubx9') },
];

/**
 * 记住上一次停留的管理分区。
 * <p>
 * 从展会卡片进二级页面再返回时，返回的哈希是 `#/admin`（不带 tab 参数），
 * 如果每次都回落到“用户”，展商就会以为自己的操作丢失了。这里用模块级变量
 * 记住选择，并把 tab 写进哈希，两者一起保证返回后仍在原来的分区。
 */
let lastTab = TABS[0].value;

/** 同步当前分区到地址栏；用 replaceState 以免污染返回栈。 */
function keepTabInUrl(tab) {
    if (typeof history === 'undefined' || !history.replaceState) {
        return;
    }
    const hash = `#/admin?tab=${encodeURIComponent(tab)}`;
    if (location.hash === hash) {
        return;
    }
    history.replaceState({ id: 'admin', params: { tab } }, '', hash);
}

export async function adminPage(context) {
    const host = el('div', { class: 'stack' });
    const requested = TABS.some((item) => item.value === context.params.tab)
        ? context.params.tab
        : lastTab;
    let tab = TABS.some((item) => item.value === requested) ? requested : TABS[0].value;
    lastTab = tab;
    let query = '';
    let settings = null;

    scaffold({
        title: t('s_cit5ds'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'admin' }),
        children: [host],
    });

    // 分段控件只创建一次，切换时滑块平滑滑动，面板内容单独更新。
    const tabs = segmented({
        label: t('s_y9zw6u'),
        value: tab,
        items: TABS,
        onChange: (value) => {
            tab = value;
            lastTab = value;
            query = '';
            keepTabInUrl(value);
            loadPanel();
        },
    });
    const panel = el('div', { class: 'stack', id: 'admin-panel' });
    replace(host, [tabs, panel]);
    // 首次进入时把分区写进地址，返回本页时可以直接恢复。
    keepTabInUrl(tab);
    loadPanel();

    async function loadPanel() {
        replace(panel, loadingBlock(3));
        try {
            if (tab === t('s_1in002o')) {
                await renderUsers(panel);
            } else if (tab === t('s_11cd4ta')) {
                await renderExhibitions(panel);
            } else {
                await renderSettings(panel);
            }
        } catch (error) {
            replace(panel, loadErrorBlock({
                title: t('s_kvpltc'),
                description: error.message,
                onRetry: () => loadPanel(),
            }));
        }
    }

    // ── 用户管理 ───────────────────────────────────────────────────

    async function renderUsers(target) {
        const users = await usersApi.list({ query });
        const cards = el('div', { class: 'list', 'data-gap': 'sm' }, users.map((user) => el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                el('span', { class: 'avatar', text: (user.nickname || t('s_cmla8n')).slice(0, 1), 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: `${user.nickname} · ${user.role}` }),
                    el('span', { class: 'row-meta', text: `${user.status} · 最近登录 ${user.lastLoginTime || t('s_1lpnuh4')}` }),
                    el('span', { class: 'row-meta truncate', text: truncate(user.email, 40) }),
                ]),
                statusTag(user.status, statusTone(user.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallCta(t('s_pzy8ri'), () => manageUser(user)),
                smallCta(t('s_gt2gfg'), () => context.navigate('user-public', { userId: user.id })),
            ]),
        ])));

        replace(target, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: t('s_1oim33') }),
                el('span', { class: 'pill', text: `${users.length} 位用户` }),
            ]),
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-user-search', text: t('s_jdu9oa') }),
                searchInput('admin-user-search', t('s_1lwkw6n'), (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: t('s_7tczm7') }),
                el('span', { text: t('s_o3jfq3') }),
            ]),
            users.length > 0
                ? cards
                : stateBlock({ title: query ? `没有找到与“${query}”相关的用户` : t('s_7qwgro') }),
        ]);
    }

    function manageUser(user) {
        const sheet = openSheet({
            title: `管理 ${user.nickname}`,
            content: [
                el('div', { class: 'stack' }, [
                    el('p', { class: 'row-meta', text: `${user.role} · 注册于 ${user.registrationTime || t('s_1lpnuh4')}` }),
                    el('div', { class: 'list', 'data-gap': 'sm' }, USER_STATUSES.map((status) => el('button', {
                        class: 'row-card',
                        type: 'button',
                        dataset: { pressable: 'true' },
                        onclick: async () => {
                            sheet.close();
                            await updateUserStatus(user, status);
                        },
                    }, [
                        el('span', { class: 'row-copy' }, [
                            el('strong', { class: 'row-title', text: status }),
                            el('span', { class: 'row-meta', text: statusHint(status) }),
                        ]),
                        user.status === status ? statusTag(t('s_1h1tn0d'), 'pending') : null,
                    ]))),
                ]),
            ],
            actions: [{ label: t('s_1589w37'), onClick: (close) => close() }],
        });
    }

    function statusHint(status) {
        if (status === t('s_tt5vxa')) {
            return t('s_o85tde');
        }
        if (status === t('s_1am6dte')) {
            return t('s_183ltm8');
        }
        return t('s_nsh78a');
    }

    async function updateUserStatus(user, status) {
        try {
            const ok = await usersApi.setStatus(user.id, status);
            toast(ok ? `已将 ${user.nickname} 设为${status}` : t('s_10lkv9z'), ok ? 'success' : 'error');
            if (ok) {
                loadPanel();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    // ── 展会管理 ───────────────────────────────────────────────────

    async function renderExhibitions(target) {
        const items = await exhibitions.list({ query });
        replace(target, [
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-exhibition-search', text: t('s_50ih74') }),
                searchInput('admin-exhibition-search', t('s_1ttdxgu'), (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: t('s_1h3z4vq') }),
                el('span', { class: 'pill', text: `${items.length} 个展会` }),
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: t('s_19eb37e') }),
                el('span', { text: t('s_2scj6a') }),
            ]),
            items.length > 0
                ? el('div', { class: 'list', 'data-gap': 'sm' }, items.map(exhibitionCard))
                : stateBlock({
                    iconName: 'search',
                    title: query ? `没有找到与“${query}”相关的展会` : t('s_1qc01ta'),
                    description: query ? t('s_1kmur0r') : t('s_1tsjagr'),
                }),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: (event) => exportCsv(event.currentTarget),
            }, [t('s_1ogoh03')]),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: t('s_nsnwn6') }),
        ]);
    }

    /** 与展商后台一致的展会卡片：信息 + 查看报名 / 编辑 / 暂停报名。 */
    function exhibitionCard(item) {
        return el('div', { class: 'card' }, [
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                style: { border: '0', padding: '0', background: 'transparent' },
                onclick: () => context.navigate('detail', { id: item.id }),
            }, [
                mediaBox({ src: item.imageUri, className: 'thumb thumb-cover' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${formatDateWithWeekday(item.date)} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                ]),
                statusTag(item.modeLabel || item.status, statusTone(item.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallCta(t('s_j8kyoz'), () => context.navigate('review', { exhibitionId: item.id })),
                smallCta(t('s_eutzzb'), () => context.navigate('exhibition-form', { id: item.id })),
                smallCta(item.openForRegistration ? t('s_2fmcqd') : t('s_1w55sta'), () => toggleLock(item)),
            ]),
        ]);
    }

    function toggleLock(item) {
        const nextStatus = item.openForRegistration
            ? EXHIBITION_STATUS.CLOSED : EXHIBITION_STATUS.REVIEW_REQUIRED;
        const title = item.openForRegistration ? t('s_2fmcqd') : t('s_1w55sta');
        const message = item.openForRegistration
            ? `暂停后「${item.title}」不可报名，展商不能自行恢复。`
            : `恢复后「${item.title}」将重新按需审核的方式收集报名。`;
        confirmSheet({
            title,
            message,
            confirmLabel: title,
            onConfirm: async () => {
                try {
                    const ok = await exhibitions.setStatus(item.id, nextStatus);
                    toast(ok ? `已${title}` : t('s_ydow7a'), ok ? 'success' : 'error');
                    if (ok) {
                        loadPanel();
                    }
                } catch (error) {
                    toast(error.message, 'error');
                }
            },
        });
    }

    async function exportCsv(button) {
        button.dataset.loading = 'true';
        try {
            const result = await call('export.csv', { type: 'exhibitions' });
            toast(`已导出 ${result.rows} 行到 ${result.fileName}`, 'success');
        } catch (error) {
            if (String(error.message).includes(t('s_1589w37'))) {
                toast(t('s_1va7jf9'));
            } else {
                toast(error.message, 'error');
            }
        } finally {
            button.dataset.loading = 'false';
        }
    }

    // ── 服务器设置 ─────────────────────────────────────────────────

    async function renderSettings(target) {
        const data = settings || await settingsApi.get();
        settings = data;

        const announcement = textarea('settings-announcement', data?.announcement?.text || '', 3);
        const titleZh = textInput('settings-title-zh', data?.brand?.zh || state.brand.zh, t('s_1wed2to'));
        const titleEn = textInput('settings-title-en', data?.brand?.en || state.brand.en, t('s_17xmsms'));
        const categories = textarea('settings-categories', (data?.categories || []).join('\n'), 4);
        const imageCount = numberInput('settings-image-count', data?.media?.imageCount ?? state.media.imageCount ?? 8);
        const imageSize = numberInput('settings-image-size', data?.media?.imageSizeMb ?? state.media.imageSizeMb ?? 10);
        const videoCount = numberInput('settings-video-count', data?.media?.videoCount ?? state.media.videoCount ?? 2);
        const avatarSize = numberInput('settings-avatar-size', data?.upload?.avatarSizeMb ?? state.server.avatarSizeMb ?? 2);
        const imageFormats = textInput('settings-image-formats',
            (data?.upload?.imageFormats || state.server.imageFormats || []).join(','), 'jpg,jpeg,png,webp');
        const videoFormats = textInput('settings-video-formats',
            (data?.upload?.videoFormats || state.server.videoFormats || []).join(','), 'mp4,mov,webm');
        const limits = data?.limits || state.limits;

        const titleLimit = numberInput('limit-exhibition-title', limits.exhibitionTitle);
        const venueLimit = numberInput('limit-exhibition-venue', limits.exhibitionVenue);
        const categoryLimit = numberInput('limit-category', limits.category);
        const fieldLimit = numberInput('limit-field-title', limits.fieldTitle);
        const usernameMin = numberInput('limit-username-min', limits.usernameMin);
        const usernameMax = numberInput('limit-username-max', limits.usernameMax);
        const passwordMin = numberInput('limit-password-min', limits.passwordMin);
        const passwordMax = numberInput('limit-password-max', limits.passwordMax);
        const nicknameLimit = numberInput('limit-nickname', limits.nickname);
        const bioLimit = numberInput('limit-bio', limits.bio);
        const regionLimit = numberInput('limit-region', limits.region);
        const answerLimit = numberInput('limit-answer', limits.answer);

        let announcementEnabled = Boolean(data?.announcement?.enabled);
        let canRevise = Boolean(data?.review?.canRevise);

        const validators = [
            fieldValidator({ control: titleZh, label: t('s_1sx8n02'), required: true, max: 20 }),
            fieldValidator({
                control: titleEn,
                label: t('s_1lwq2zi'),
                required: true,
                max: 24,
                pattern: /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
                patternMessage: t('s_1q0bxzm'),
            }),
            fieldValidator({
                control: imageFormats,
                label: t('s_a4vkn3'),
                max: 120,
                pattern: /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/,
                patternMessage: t('s_1c9tz51'),
            }),
            fieldValidator({
                control: videoFormats,
                label: t('s_1hybard'),
                max: 120,
                pattern: /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/,
                patternMessage: t('s_15k74t0'),
            }),
        ];
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });

        replace(target, [
            el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
                el('strong', { text: t('s_1l8hptt') }),
                el('span', { text: t('s_3fdon3') }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_vxwprj') }),
                el('p', { class: 'field-hint', text: t('s_l2amry') }),
                el('div', { class: 'field' }, [
                    el('label', { for: titleZh.id, text: t('s_1sx8n02') }),
                    titleZh,
                ]),
                el('div', { class: 'field' }, [
                    el('label', { for: titleEn.id, text: t('s_1lwq2zi') }),
                    titleEn,
                    el('p', { class: 'field-hint', text: t('s_7sexex') }),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_1dao2v1') }),
                announcement,
                switchRow({
                    id: 'settings-announcement-enabled',
                    label: t('s_5rwrkf'),
                    description: t('s_1jh4uc4'),
                    checked: announcementEnabled,
                    onChange: (value) => {
                        announcementEnabled = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_1v7py1m') }),
                categories,
                el('p', { class: 'field-hint', text: t('s_19brgqa') }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_1shj529') }),
                switchRow({
                    id: 'settings-revise',
                    label: t('s_11iu5s7'),
                    description: t('s_qt3xw0'),
                    checked: canRevise,
                    onChange: (value) => {
                        canRevise = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_6w32w9') }),
                numberField(t('s_s2a1jr'), imageCount, t('s_accfpb')),
                numberField(t('s_ixjm5p'), imageSize, 'MB'),
                numberField(t('s_1wlt01z'), videoCount, t('s_d5a1x9')),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_15f0vvs') }),
                el('div', { class: 'field' }, [
                    el('label', { for: imageFormats.id, text: t('s_kthke1') }),
                    imageFormats,
                    el('p', { class: 'field-hint', text: t('s_uwhq7a') }),
                ]),
                el('div', { class: 'field' }, [
                    el('label', { for: videoFormats.id, text: t('s_injt47') }),
                    videoFormats,
                    el('p', { class: 'field-hint', text: t('s_1ezkwzh') }),
                ]),
                numberField(t('s_1y26ptk'), avatarSize, 'MB'),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: t('s_rlbden') }),
                el('p', { class: 'field-hint', text: t('s_dpoory') }),
                el('div', { class: 'grid-cols-2' }, [
                    numberField(t('s_1co82cb'), titleLimit, t('s_1mcmbiu')),
                    numberField(t('s_1tlfy5l'), venueLimit, t('s_1mcmbiu')),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField(t('s_9xu72h'), categoryLimit, t('s_1mcmbiu')),
                    numberField(t('s_1yqwetn'), fieldLimit, t('s_1mcmbiu')),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField(t('s_dtadu0'), usernameMin, t('s_1mcmbiu')),
                    numberField(t('s_196bpby'), usernameMax, t('s_1mcmbiu')),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField(t('s_e6tqxb'), passwordMin, t('s_1jlgtug')),
                    numberField(t('s_19rf1tx'), passwordMax, t('s_1jlgtug')),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField(t('s_jxewei'), nicknameLimit, t('s_1mcmbiu')),
                    numberField(t('s_euttee'), bioLimit, t('s_1mcmbiu')),
                ]),
                numberField(t('s_16txual'), regionLimit, t('s_1mcmbiu')),
                numberField(t('s_1j77by5'), answerLimit, t('s_1mcmbiu')),
            ]),
            errorBox,
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => saveSettings(),
            }, [t('s_usxjfe')]),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: t('s_2olj7t'),
            }),
        ]);

        async function saveSettings() {
            const result = validateAll(validators);
            if (!result.ok) {
                errorBox.textContent = result.message;
                errorBox.hidden = false;
                result.validator.focus();
                return;
            }
            errorBox.hidden = true;
            try {
                const saved = await settingsApi.save({
                    appTitleZh: titleZh.value.trim(),
                    appTitleEn: titleEn.value.trim(),
                    announcement: announcement.value.trim(),
                    announcementEnabled,
                    categories: categories.value.split('\n').map((item) => item.trim()).filter(Boolean),
                    canRevise,
                    imageCount: Number(imageCount.value) || 0,
                    imageSizeMb: Number(imageSize.value) || 0,
                    videoCount: Number(videoCount.value) || 0,
                    avatarSizeMb: Number(avatarSize.value) || 0,
                    imageFormats: imageFormats.value.trim(),
                    videoFormats: videoFormats.value.trim(),
                    exhibitionTitle: Number(titleLimit.value) || 0,
                    exhibitionVenue: Number(venueLimit.value) || 0,
                    category: Number(categoryLimit.value) || 0,
                    fieldTitle: Number(fieldLimit.value) || 0,
                    usernameMin: Number(usernameMin.value) || 0,
                    usernameMax: Number(usernameMax.value) || 0,
                    passwordMin: Number(passwordMin.value) || 0,
                    passwordMax: Number(passwordMax.value) || 0,
                    nickname: Number(nicknameLimit.value) || 0,
                    bio: Number(bioLimit.value) || 0,
                    region: Number(regionLimit.value) || 0,
                    answer: Number(answerLimit.value) || 0,
                });
                if (!saved?.ok) {
                    errorBox.textContent = t('s_jibr3q');
                    errorBox.hidden = false;
                    return;
                }
                settings = saved.settings;
                applySettings(settings);
                toast(t('s_1qb27ho'), 'success');
                loadPanel();
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.hidden = false;
            }
        }
    }

    // ── 小工具 ─────────────────────────────────────────────────────

    function numberField(label, control, suffix) {
        return el('div', { class: 'field' }, [
            el('label', { for: control.id, text: label }),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                control,
                el('span', { class: 'row-meta', text: suffix }),
            ]),
        ]);
    }

    function textarea(id, value, rows) {
        const control = el('textarea', { class: 'textarea', id, rows: rows || 3 });
        control.value = value || '';
        return control;
    }

    function textInput(id, value, placeholder) {
        return el('input', { class: 'input', id, type: 'text', value: value || '', placeholder });
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

    /** 搜索框带 220ms 防抖，避免每次按键都触发一次桥接。 */
    function searchInput(id, placeholder, onChange) {
        const input = el('input', { class: 'input', id, type: 'search', placeholder, autocomplete: 'off' });
        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => onChange(input.value.trim()), 220);
        });
        return input;
    }
}
