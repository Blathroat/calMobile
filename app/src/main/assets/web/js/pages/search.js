import { t } from '../core/strings.js';
/**
 * 屏幕 06 · 搜索
 * 线框：docs/newUI/remaining-ui.html #screen-search
 * 业务：GET /search（server/ 的 REST）在展会与用户之间按关键词检索。
 *
 * 取数走 core/loadable.js：同一个关键词的结果会进缓存，改回上次的词直接出内容。
 */

// render() 里的局部变量占用了 exhibitions / users 这两个名字（搜索结果数组），
// 这里用别名导入取数接口，避免被局部变量遮蔽。
import { api, exhibitions as exhibitionsApi, users as usersApi } from '../core/api.js';
import { loadInto } from '../core/loadable.js';
import { warmOnPress } from '../core/preload.js';
import { scaffold } from '../core/router.js';
import { mediaBox, stateBlock, statusTag, statusTone } from '../ui/components.js';
import { el, replace, truncate } from '../core/dom.js';

export async function searchPage(context) {
    const resultsHost = el('div', { class: 'stack' });
    const countText = el('span', { class: 'pill', text: t('s_1s57su3') });
    const input = el('input', {
        class: 'input',
        id: 'search-input',
        type: 'search',
        placeholder: '展会 / 地点 / 用户',
        value: context.params.q || '',
        autocomplete: 'off',
    });

    scaffold({
        title: t('s_367f3v'),
        bodyProps: { 'data-gap': 'tight' },
        children: [            el('div', { class: 'field' }, [el('label', { for: 'search-input', text: t('s_1sd7orv') }), input]),
            el('div', { class: 'row', 'data-between': 'true' }, [
                el('span', { class: 'section-label', text: t('s_i8d8h8') }),
                countText,
            ]),
            resultsHost,
        ],
    });

    replace(resultsHost, stateBlock({
        iconName: 'search',
        title: t('s_3fklp8'),
        description: t('s_1m0n2yt'),
    }));

    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(input.value.trim()), 220);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(timer);
            run(input.value.trim());
        }
    });

    if (input.value.trim()) {
        run(input.value.trim());
    }

    async function run(query) {
        if (!query) {
            countText.textContent = t('s_1s57su3');
            replace(resultsHost, stateBlock({
                iconName: 'search',
                title: t('s_3fklp8'),
                description: t('s_1m0n2yt'),
            }));
            return;
        }
        // 搜索同样先画缓存：改回同一个关键词时不再先闪骨架屏。
        await loadInto(resultsHost, {
            read: api.search,
            params: query,
            rows: 2,
            errorTitle: t('s_2be1oh'),
            render: (data) => {
                countText.textContent = `${data.count} 条结果`;
                render(data, query);
            },
        });
    }

    function render(data, query) {
        const exhibitions = data.exhibitions || [];
        const users = data.users || [];
        if (exhibitions.length === 0 && users.length === 0) {
            replace(resultsHost, stateBlock({
                iconName: 'search',
                title: `没有找到与“${query}”相关的结果`,
                description: t('s_s4kamn'),
                action: { label: t('s_17zyr1e'), onClick: () => context.navigate('home') },
            }));
            return;
        }

        const blocks = [];
        if (exhibitions.length > 0) {
            blocks.push(el('span', { class: 'section-label', text: `展会 · ${exhibitions.length}` }));
            blocks.push(el('div', { class: 'list', 'data-gap': 'sm' },
                exhibitions.map((item) => el('button', {
                    class: 'row-card',
                    type: 'button',
                    dataset: { pressable: 'true' },
                    // 手指按下就先取展会详情，点进详情页时数据通常已经到了。
                    ...warmOnPress(exhibitionsApi.get, { id: item.id }),
                    onclick: () => context.navigate('detail', { id: item.id }),
                }, [
                    mediaBox({ src: item.imageUri, className: 'thumb thumb-sm thumb-cover' }),
                    el('span', { class: 'row-copy' }, [
                        el('span', { class: 'row', 'data-gap': 'md' }, [
                            el('strong', { class: 'row-title truncate', text: item.title }),
                            statusTag(item.modeLabel || item.status, statusTone(item.status)),
                        ]),
                        el('span', { class: 'row-meta', text: `${item.dateLabel} ${item.time}` }),
                        el('span', { class: 'row-meta truncate', text: item.venue }),
                    ]),
                ]))));
        }
        if (users.length > 0) {
            blocks.push(el('span', { class: 'section-label', text: `用户 · ${users.length}` }));
            blocks.push(el('div', { class: 'list', 'data-gap': 'sm' },
                users.map((user) => el('button', {
                    class: 'row-card',
                    type: 'button',
                    dataset: { pressable: 'true' },
                    // 用户公开页读的是 users.public，按同一个 userId 预热。
                    ...warmOnPress(usersApi.publicProfile, { userId: user.id }),
                    onclick: () => context.navigate('user-public', { userId: user.id }),
                }, [
                    el('span', { class: 'avatar', text: (user.nickname || t('s_cmla8n')).slice(0, 1), 'aria-hidden': 'true' }),
                    el('span', { class: 'row-copy' }, [
                        el('strong', { class: 'row-title', text: `${user.nickname} · ${user.role}` }),
                        el('span', { class: 'row-meta truncate', text: truncate(user.email, 40) }),
                    ]),
                    statusTag(user.status, statusTone(user.status)),
                ]))));
        }
        replace(resultsHost, el('div', { class: 'stack' }, blocks));
    }
}
