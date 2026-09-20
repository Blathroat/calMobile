import { t } from '../core/strings.js';
/**
 * 屏幕 10 · 展商后台
 * 线框：newUI/remaining-ui.html #screen-exhibitor-backend
 * 业务：GET /exhibitions（server/ 的 REST），报名管理与展会编辑入口。
 *
 * 卡片上只保留“查看报名”和“编辑展会”两个入口：报名方式、编辑简介与删除展会
 * 都属于展会的配置，统一放进“编辑展会”对应的二级界面，卡片保持清爽。
 * 顶部提供“核销报名码”，展商在现场扫描用户报名详情里的二维码即可完成核销。
 *
 * 取数走 core/loadable.js：命中缓存时同步出内容，切回本页不会先闪骨架屏。
 */

import { exhibitions } from '../core/api.js';
import { state } from '../core/bridge.js';
import { loadInto } from '../core/loadable.js';
import { warmOnPress } from '../core/preload.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { mediaBox, smallCta, stateBlock, statusTag, statusTone, toast } from '../ui/components.js';
import { el, replace } from '../core/dom.js';

export async function exhibitorPage(context) {
    const listHost = el('div', { class: 'stack' });
    /**
     * 受限账号不能发布新展会（后端 `POST /exhibitions` 直接 403）。
     * 入口提前置灰并说明原因，而不是让展商填完表单才吃 403；
     * 受限的展商照样能进后台、查看与审核已有的报名，因此后台本身不封。
     */
    const limited = state.user.can?.limited === true;
    const createAction = topAction('plus', t('s_p9fllo'), () => createExhibition());
    if (limited) {
        createAction.setAttribute('disabled', '');
        createAction.setAttribute('aria-disabled', 'true');
        createAction.setAttribute('title', t('s_19wazv8'));
    }
    scaffold({
        title: t('s_1omalh8'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [
            topAction('scan', t('s_zqzoiq'), () => context.navigate('checkin')),
            createAction,
        ],
        foot: tabbar({ items: navItems(), active: 'exhibitor' }),
        children: [listHost],
    });

    /** 新建展会：受限时用同一句提示兜住残留入口（空态按钮、底部主按钮、回车键）。 */
    function createExhibition() {
        if (limited) {
            toast(t('s_19wazv8'), 'error');
            return;
        }
        context.navigate('exhibition-form', { mode: 'create' });
    }

    // 列表整体交给 loadInto：先画缓存，远端结果到了才重绘，容器始终不清空。
    await loadInto(listHost, {
        read: exhibitions.list,
        rows: 3,
        errorTitle: t('s_4e7do4'),
        render: (items) => {
            if (items.length === 0) {
                replace(listHost, stateBlock({
                    iconName: 'briefcase',
                    title: t('s_f4agbb'),
                    description: limited ? t('s_19wazv8') : t('s_1t8d6e3'),
                    action: limited ? null : { label: t('s_p9fllo'), onClick: () => createExhibition() },
                }));
                return;
            }
            const total = items.reduce((sum, item) => sum + (item.registrationCount || 0), 0);
            replace(listHost, [
                el('div', { class: 'row', 'data-between': 'true' }, [
                    el('span', { class: 'section-label', text: t('s_15vddzv') }),
                    el('span', { class: 'pill', text: `${items.length} 个 · ${total} 条报名` }),
                ]),
                limitedNotice(),
                el('button', {
                    class: 'cta ghost',
                    type: 'button',
                    onclick: () => context.navigate('checkin'),
                }, [t('s_zqzoiq')]),
                el('p', {
                    class: 'field-hint',
                    style: { textAlign: 'center' },
                    text: t('s_1w3gehu'),
                }),
                el('div', { class: 'list', 'data-gap': 'sm' }, items.map((item) => card(item))),
                el('button', {
                    class: 'cta',
                    type: 'button',
                    disabled: limited ? true : null,
                    title: limited ? t('s_19wazv8') : null,
                    onclick: () => createExhibition(),
                }, [t('s_p9fllo')]),
            ]);
        },
    });

    /** 受限说明：让「新建展会为什么点不动」在页面上直接有答案。 */
    function limitedNotice() {
        if (!limited) {
            return null;
        }
        return el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
            el('strong', { text: t('s_19wazv8') }),
            el('span', { text: t('s_1yv1vu0') }),
        ]);
    }

    /**
     * 展会卡片：信息 + 查看报名 / 编辑展会。
     * 报名方式、编辑简介、删除展会都收进“编辑展会”的二级界面。
     */
    function card(item) {
        return el('div', { class: 'card' }, [
            el('button', {
                class: 'row-card',
                type: 'button',
                dataset: { pressable: 'true' },
                style: { border: '0', padding: '0', background: 'transparent' },
                // 手指按下就先取展会详情，点进详情页时数据通常已经到了。
                ...warmOnPress(exhibitions.get, { id: item.id }),
                onclick: () => context.navigate('detail', { id: item.id }),
            }, [
                mediaBox({ src: item.imageUri, className: 'thumb thumb-cover' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${item.dateLabel} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                    item.qrEnabled
                        ? el('span', { class: 'row-meta', text: t('s_1ibqlvv') })
                        : null,
                ]),
                statusTag(item.modeLabel, statusTone(item.status)),
            ]),
            el('div', { class: 'grid-cols-2' }, [
                smallCta(t('s_j8kyoz'), () => context.navigate('review', { exhibitionId: item.id }), { grow: false }),
                smallCta(t('s_eutzzb'), () => context.navigate('exhibition-form', { id: item.id }), { grow: false }),
            ]),
        ]);
    }
}
