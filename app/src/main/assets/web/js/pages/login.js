import { t } from '../core/strings.js';
/**
 * 屏幕 01 · 入口（登录 / 访客）
 * 线框：newUI/index.html #screen-login、newUI/remaining-ui.html #screen-login
 * 业务：POST /auth/login 与 POST /auth/guest（server/ 的 REST），通过后进入首页。
 */

import { state, whenReady } from '../core/bridge.js';
import { auth } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { toast } from '../ui/components.js';
import { el, append } from '../core/dom.js';
import { fieldValidator, validateAll, limit } from '../core/validate.js';

export async function loginPage(context) {
    const body = scaffold({
        title: t('s_1yggxgd'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        children: [],
    });

    const form = el('form', { class: 'form', novalidate: true });
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cta', type: 'submit' }, [t('s_1yggxgd')]);
    const guest = el('button', { class: 'cta ghost', type: 'button' }, [t('s_1jfbdwq')]);

    const account = el('input', {
        class: 'input',
        id: 'login-account',
        type: 'text',
        placeholder: '昵称 / 邮箱',
        autocomplete: 'username',
    });
    const password = el('input', {
        class: 'input',
        id: 'login-password',
        type: 'password',
        placeholder: t('s_f478sb'),
        autocomplete: 'current-password',
    });

    append(form, [
        el('div', { class: 'field' }, [el('label', { for: 'login-account', text: t('s_yuxvje') }), account]),
        el('div', { class: 'field' }, [el('label', { for: 'login-password', text: t('s_1aph6eg') }), password]),
        errorBox,
        submit,
        guest,
    ]);

    // 登录只校验必填与长度上限，不套用注册时的最短长度，避免老账号无法登录。
    const validators = [
        fieldValidator({ control: account, label: t('s_yuxvje'), required: true, max: limit('usernameMax', 20) }),
        fieldValidator({ control: password, label: t('s_1aph6eg'), required: true, max: limit('passwordMax', 32) }),
    ];

    const intro = el('div', { class: 'stack', style: { textAlign: 'center', justifyItems: 'center' } }, [
        el('span', {
            class: 'ph-img',
            style: {
                width: '84px',
                height: '84px',
                borderRadius: '20px',
                display: 'grid',
                placeItems: 'center',
                fontSize: '34px',
                fontWeight: '800',
                color: 'var(--frame)',
                background: 'var(--f2)',
            },
            text: t('s_1lsc240'),
            'aria-hidden': 'true',
        }),
        el('h2', { text: state.brand.zh }),
        el('p', { class: 'muted', text: t('s_3zbkfg') }),
    ]);

    append(body, [intro]);

    if (state.announcement.enabled && state.announcement.text) {
        append(body, el('div', { class: 'notice', dataset: { tone: 'accent' } }, [
            el('strong', { text: t('s_153oaxf') }),
            el('span', { text: state.announcement.text }),
        ]));
    }

    append(body, [form]);
    append(body, el('div', { class: 'notice' }, [
        el('span', {
            text: '演示账号：demo / exhibitor / user，密码均为 password',
        }),
    ]));

    const footer = el('footer', {
        class: 'row',
        style: { justifyContent: 'center', padding: 'var(--s3)' },
    }, [
        el('span', { class: 'dim', text: t('s_und5qj') }),
        el('button', {
            class: 'text-action',
            type: 'button',
            onclick: () => context.navigate('register'),
        }, [t('s_1fwr1ko')]),
    ]);
    append(body, footer);

    guest.addEventListener('click', async () => {
        // 访客身份也由后端签发（POST /auth/guest）：后端没起或端口没转发时必须说清楚，
        // 否则按钮点了没有任何反应，看起来像坏的。
        errorBox.hidden = true;
        guest.dataset.loading = 'true';
        guest.disabled = true;
        try {
            const result = await auth.guest();
            if (!result?.ok) {
                showError(result?.error || t('s_rn5blf'));
                return;
            }
            Object.assign(state.user, { loggedIn: false, guest: true, role: 'guest', roleLabel: t('s_h6o1xg') }, result.user || {});
            await whenReady();
            context.navigate(context.params.redirect || 'home', redirectParams(), { replace: true });
        } catch (error) {
            showError(error.message);
        } finally {
            guest.dataset.loading = 'false';
            guest.disabled = false;
        }
    });

    /** 登录前所在页面携带的参数（例如展会 id），登录后原样带回。 */
    function redirectParams() {
        const params = {};
        for (const pair of String(context.params.redirectParams || '').split('&')) {
            const [key, value] = pair.split('=');
            if (key) {
                params[key] = decodeURIComponent(value || '');
            }
        }
        return params;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const checked = validateAll(validators);
        if (!checked.ok) {
            showError(checked.message);
            return;
        }
        submit.dataset.loading = 'true';
        submit.disabled = true;
        try {
            const result = await auth.login(account.value.trim(), password.value);
            if (!result?.ok) {
                showError(result?.error || t('s_rn5blf'));
                return;
            }
            Object.assign(state.user, result.user || {});
            toast(`欢迎回来，${state.user.nickname || state.user.username}`, 'success');
            context.navigate(context.params.redirect || 'home', redirectParams(), { replace: true });
        } catch (error) {
            showError(error.message);
        } finally {
            submit.dataset.loading = 'false';
            submit.disabled = false;
        }
    });

    function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
    }
}
