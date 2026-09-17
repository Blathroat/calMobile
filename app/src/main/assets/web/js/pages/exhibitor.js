/**
 * 屏幕 10 · 展商后台
 * 线框：newUI/remaining-ui.html #screen-exhibitor-backend
 * 业务：ExhibitionManager.listAll，报名管理与展会编辑入口。
 *
 * 卡片上只保留“查看报名”和“编辑展会”两个入口：报名方式、编辑简介与删除展会
 * 都属于展会的配置，统一放进“编辑展会”对应的二级界面，卡片保持清爽。
 * 顶部提供“核销报名码”，展商在现场扫描用户报名详情里的二维码即可完成核销。
 */

import { call } from '../core/bridge.js';
import { scaffold, tabbar, navItems, topAction } from '../core/router.js';
import { loadingBlock, stateBlock, statusTag, statusTone, mediaBox } from '../ui/components.js';
import { el, replace } from '../core/dom.js';

export async function exhibitorPage(context) {
    const listHost = el('div', { class: 'stack' });
    scaffold({
        title: '展商后台',
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        actions: [
            topAction('scan', '核销报名码', () => context.navigate('checkin')),
            topAction('plus', '新建展会', () => context.navigate('exhibition-form', { mode: 'create' })),
        ],
        foot: tabbar({ items: navItems(), active: 'exhibitor' }),
        children: [listHost],
    });

    replace(listHost, loadingBlock(3));
    try {
        const items = await call('exhibitions.list');
        if (items.length === 0) {
            replace(listHost, stateBlock({
                iconName: 'briefcase',
                title: '还没有举办中的展会',
                description: '创建第一个展会，配置日期、地点与报名收集项。',
                action: { label: '新建展会', onClick: () => context.navigate('exhibition-form', { mode: 'create' }) },
            }));
            return;
        }
        const total = items.reduce((sum, item) => sum + (item.registrationCount || 0), 0);
        replace(listHost, [
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: '我举办的展会' }),
                el('span', { class: 'pill', text: `${items.length} 个 · ${total} 条报名` }),
            ]),
            el('button', {
                class: 'cta ghost',
                type: 'button',
                onclick: () => context.navigate('checkin'),
            }, ['核销报名码']),
            el('p', {
                class: 'field-hint',
                style: { textAlign: 'center' },
                text: '报名审核通过后，用户可在报名详情里出示报名码，现场扫码即完成核销。',
            }),
            el('div', { class: 'list', 'data-gap': 'sm' }, items.map((item) => card(item))),
            el('button', {
                class: 'cta',
                type: 'button',
                onclick: () => context.navigate('exhibition-form', { mode: 'create' }),
            }, ['新建展会']),
        ]);
    } catch (error) {
        replace(listHost, stateBlock({
            tone: 'error',
            title: '展会列表加载失败',
            description: error.message,
            action: { label: '重试', onClick: () => context.refresh() },
        }));
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
                onclick: () => context.navigate('detail', { id: item.id }),
            }, [
                mediaBox({ src: item.imageUri, className: 'thumb thumb-cover' }),
                el('span', { class: 'row-copy' }, [
                    el('strong', { class: 'row-title truncate', text: item.title }),
                    el('span', { class: 'row-meta', text: `${item.dateLabel} ${item.time}` }),
                    el('span', { class: 'row-meta truncate', text: item.venue }),
                    el('span', { class: 'row-meta', text: `${item.status} · ${item.registrationCount} 条报名` }),
                    item.qrEnabled
                        ? el('span', { class: 'row-meta', text: '已启用报名二维码' })
                        : null,
                ]),
                statusTag(item.modeLabel, statusTone(item.status)),
            ]),
            el('div', { class: 'grid-cols-2' }, [
                actionButton('查看报名', () => context.navigate('review', { exhibitionId: item.id })),
                actionButton('编辑展会', () => context.navigate('exhibition-form', { id: item.id })),
            ]),
        ]);
    }

    function actionButton(label, onClick) {
        return el('button', {
            class: 'cta ghost',
            type: 'button',
            style: { minHeight: '44px', fontSize: 'var(--fs-label)' },
            onclick: onClick,
        }, [label]);
    }
}
