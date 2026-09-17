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
import { scaffold, tabbar, navItems } from '../core/router.js';
import { confirmSheet, loadErrorBlock, loadingBlock, mediaBox, openSheet, segmented, smallCta, stateBlock, statusTag, statusTone, switchRow, toast } from '../ui/components.js';
import { el, replace, truncate, formatDateWithWeekday } from '../core/dom.js';
import { EXHIBITION_STATUS } from '../core/status.js';
import { fieldValidator, validateAll } from '../core/validate.js';

const USER_STATUSES = ['正常', '受限', '封禁'];

const TABS = [
    { value: '用户', label: '用户' },
    { value: '展会', label: '展会' },
    { value: '设置', label: '设置' },
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
        title: '管理后台',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        foot: tabbar({ items: navItems(), active: 'admin' }),
        children: [host],
    });

    // 分段控件只创建一次，切换时滑块平滑滑动，面板内容单独更新。
    const tabs = segmented({
        label: '管理分区',
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
            if (tab === '用户') {
                await renderUsers(panel);
            } else if (tab === '展会') {
                await renderExhibitions(panel);
            } else {
                await renderSettings(panel);
            }
        } catch (error) {
            replace(panel, loadErrorBlock({
                title: '加载失败',
                description: error.message,
                onRetry: () => loadPanel(),
            }));
        }
    }

    // ── 用户管理 ───────────────────────────────────────────────────

    async function renderUsers(target) {
        const users = await call('users.list', { query });
        const cards = el('div', { class: 'list', 'data-gap': 'sm' }, users.map((user) => el('div', { class: 'card' }, [
            el('div', { class: 'row', 'data-gap': 'md' }, [
                el('span', { class: 'avatar', text: (user.nickname || '用').slice(0, 1), 'aria-hidden': 'true' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title', text: `${user.nickname} · ${user.role}` }),
                    el('span', { class: 'row-meta', text: `${user.status} · 最近登录 ${user.lastLoginTime || '未知'}` }),
                    el('span', { class: 'row-meta truncate', text: truncate(user.email, 40) }),
                ]),
                statusTag(user.status, statusTone(user.status)),
            ]),
            el('div', { class: 'row', 'data-gap': 'md' }, [
                smallCta('管理', () => manageUser(user)),
                smallCta('公开页', () => context.navigate('user-public', { userId: user.id })),
            ]),
        ])));

        replace(target, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '用户管理' }),
                el('span', { class: 'pill', text: `${users.length} 位用户` }),
            ]),
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-user-search', text: '搜索用户' }),
                searchInput('admin-user-search', '昵称或邮箱', (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: '账号状态' }),
                el('span', { text: '状态变更会立即写入本地数据库，受限用户保留登录但限制报名。' }),
            ]),
            users.length > 0
                ? cards
                : stateBlock({ title: query ? `没有找到与“${query}”相关的用户` : '暂无用户数据' }),
        ]);
    }

    function manageUser(user) {
        const sheet = openSheet({
            title: `管理 ${user.nickname}`,
            content: [
                el('div', { class: 'stack' }, [
                    el('p', { class: 'row-meta', text: `${user.role} · 注册于 ${user.registrationTime || '未知'}` }),
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
                        user.status === status ? statusTag('当前', 'pending') : null,
                    ]))),
                ]),
            ],
            actions: [{ label: '取消', onClick: (close) => close() }],
        });
    }

    function statusHint(status) {
        if (status === '正常') {
            return '可正常浏览与报名';
        }
        if (status === '受限') {
            return '保留登录，限制部分操作';
        }
        return '禁止登录与报名';
    }

    async function updateUserStatus(user, status) {
        try {
            const ok = await call('users.status', { id: user.id, status });
            toast(ok ? `已将 ${user.nickname} 设为${status}` : '更新失败', ok ? 'success' : 'error');
            if (ok) {
                loadPanel();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    // ── 展会管理 ───────────────────────────────────────────────────

    async function renderExhibitions(target) {
        const items = await call('exhibitions.list', { query });
        replace(target, [
            el('div', { class: 'field' }, [
                el('label', { for: 'admin-exhibition-search', text: '搜索展会' }),
                searchInput('admin-exhibition-search', '展会名称、地点或分类', (value) => {
                    query = value;
                    loadPanel();
                }),
            ]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '全部展会' }),
                el('span', { class: 'pill', text: `${items.length} 个展会` }),
            ]),
            el('div', { class: 'notice' }, [
                el('strong', { text: '管理员暂停报名' }),
                el('span', { text: '暂停后普通用户不可报名，展商不可自行恢复。' }),
            ]),
            items.length > 0
                ? el('div', { class: 'list', 'data-gap': 'sm' }, items.map(exhibitionCard))
                : stateBlock({
                    iconName: 'search',
                    title: query ? `没有找到与“${query}”相关的展会` : '暂无展会数据',
                    description: query ? '换个关键词，或清空搜索查看全部展会。' : '展商创建展会后会出现在这里。',
                }),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: (event) => exportCsv(event.currentTarget),
            }, ['导出 CSV']),
            el('p', { class: 'field-hint', style: { textAlign: 'center' }, text: '导出内容为当前展会列表，文件通过系统保存对话框写入。' }),
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
                smallCta('查看报名', () => context.navigate('review', { exhibitionId: item.id })),
                smallCta('编辑展会', () => context.navigate('exhibition-form', { id: item.id })),
                smallCta(item.openForRegistration ? '暂停报名' : '恢复报名', () => toggleLock(item)),
            ]),
        ]);
    }

    function toggleLock(item) {
        const nextStatus = item.openForRegistration
            ? EXHIBITION_STATUS.CLOSED : EXHIBITION_STATUS.REVIEW_REQUIRED;
        const title = item.openForRegistration ? '暂停报名' : '恢复报名';
        const message = item.openForRegistration
            ? `暂停后「${item.title}」不可报名，展商不能自行恢复。`
            : `恢复后「${item.title}」将重新按需审核的方式收集报名。`;
        confirmSheet({
            title,
            message,
            confirmLabel: title,
            onConfirm: async () => {
                try {
                    const ok = await call('exhibitions.status', { id: item.id, status: nextStatus });
                    toast(ok ? `已${title}` : '操作失败', ok ? 'success' : 'error');
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
            if (String(error.message).includes('取消')) {
                toast('已取消导出');
            } else {
                toast(error.message, 'error');
            }
        } finally {
            button.dataset.loading = 'false';
        }
    }

    // ── 服务器设置 ─────────────────────────────────────────────────

    async function renderSettings(target) {
        const data = settings || await call('settings.get');
        settings = data;

        const announcement = textarea('settings-announcement', data?.announcement?.text || '', 3);
        const titleZh = textInput('settings-title-zh', data?.brand?.zh || state.brand.zh, '例如：发现展会');
        const titleEn = textInput('settings-title-en', data?.brand?.en || state.brand.en, '例如：calMobile');
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
            fieldValidator({ control: titleZh, label: '中文标题', required: true, max: 20 }),
            fieldValidator({
                control: titleEn,
                label: '英文标题',
                required: true,
                max: 24,
                pattern: /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
                patternMessage: '英文标题只能包含字母、数字、空格与 . _ -',
            }),
            fieldValidator({
                control: imageFormats,
                label: '图片格式',
                max: 120,
                pattern: /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/,
                patternMessage: '请用英文逗号分隔后缀，例如 jpg,png',
            }),
            fieldValidator({
                control: videoFormats,
                label: '视频格式',
                max: 120,
                pattern: /^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/,
                patternMessage: '请用英文逗号分隔后缀，例如 mp4,mov',
            }),
        ];
        const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });

        replace(target, [
            el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
                el('strong', { text: '服务器设置' }),
                el('span', { text: '这里的配置保存在服务端，保存后对所有用户与展商同时生效。' }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '软件标题' }),
                el('p', { class: 'field-hint', text: '中文标题显示在首页上方的“发现展会”位置，英文标题显示在它上方与其他展示应用名称的位置。' }),
                el('div', { class: 'field' }, [
                    el('label', { for: titleZh.id, text: '中文标题' }),
                    titleZh,
                ]),
                el('div', { class: 'field' }, [
                    el('label', { for: titleEn.id, text: '英文标题' }),
                    titleEn,
                    el('p', { class: 'field-hint', text: '同时显示在首页、我的报名、报名管理等页面的品牌行。' }),
                ]),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '进入应用时的公告' }),
                announcement,
                switchRow({
                    id: 'settings-announcement-enabled',
                    label: '进入应用时显示公告',
                    description: '用户打开首页时展示一次',
                    checked: announcementEnabled,
                    onChange: (value) => {
                        announcementEnabled = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '展会分类管理' }),
                categories,
                el('p', { class: 'field-hint', text: '每行一个分类，用于展商填写与搜索筛选。' }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '审核策略' }),
                switchRow({
                    id: 'settings-revise',
                    label: '允许修改已通过或已拒绝的报名',
                    description: '开启后展商可以重新审核已处理的报名；无需审核的展会提交后直接通过。',
                    checked: canRevise,
                    onChange: (value) => {
                        canRevise = value;
                    },
                }),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '富文本媒体限制' }),
                numberField('每篇图片数量上限', imageCount, '张'),
                numberField('单张图片大小', imageSize, 'MB'),
                numberField('视频数量上限', videoCount, '个'),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '上传格式限制' }),
                el('div', { class: 'field' }, [
                    el('label', { for: imageFormats.id, text: '允许的图片后缀' }),
                    imageFormats,
                    el('p', { class: 'field-hint', text: '由文件后缀与英文逗号组成，例如 jpg,jpeg,png,webp。' }),
                ]),
                el('div', { class: 'field' }, [
                    el('label', { for: videoFormats.id, text: '允许的视频后缀' }),
                    videoFormats,
                    el('p', { class: 'field-hint', text: '例如 mp4,mov,webm，超出列表的文件会被拒绝。' }),
                ]),
                numberField('头像大小上限', avatarSize, 'MB'),
            ]),
            el('div', { class: 'card' }, [
                el('span', { class: 'section-label', text: '表单字符数上限' }),
                el('p', { class: 'field-hint', text: '作用于普通用户与展商可自由填写的字段，超长时前端即时提示。' }),
                el('div', { class: 'grid-cols-2' }, [
                    numberField('展会名称', titleLimit, '字'),
                    numberField('展会地点', venueLimit, '字'),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField('展会分类', categoryLimit, '字'),
                    numberField('收集项标题', fieldLimit, '字'),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField('用户名最短', usernameMin, '字'),
                    numberField('用户名最长', usernameMax, '字'),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField('密码最短', passwordMin, '位'),
                    numberField('密码最长', passwordMax, '位'),
                ]),
                el('div', { class: 'grid-cols-2' }, [
                    numberField('昵称上限', nicknameLimit, '字'),
                    numberField('简介上限', bioLimit, '字'),
                ]),
                numberField('地区上限', regionLimit, '字'),
                numberField('报名填写内容', answerLimit, '字'),
            ]),
            errorBox,
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => saveSettings(),
            }, ['保存服务器设置']),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: '保存后立即下发到所有用户的表单校验与上传校验。',
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
                const saved = await call('settings.save', {
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
                    errorBox.textContent = '保存失败，请稍后重试';
                    errorBox.hidden = false;
                    return;
                }
                settings = saved.settings;
                applySettings(settings);
                toast('服务器设置已保存', 'success');
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
