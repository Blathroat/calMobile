import { t } from '../core/strings.js';
/**
 * 屏幕 01 · 入口（登录 / 访客 / 两步验证）
 * 线框：newUI/index.html #screen-login、newUI/remaining-ui.html #screen-login
 * 业务：POST /auth/login 与 POST /auth/guest（server/ 的 REST），通过后进入首页。
 *
 * 账号开了两步验证时，`POST /auth/login` **不回令牌**，只回一张 5 分钟有效的预认证票
 * 并把验证码发到邮箱；这一页的第二步拿票 + 码换真正的会话（`POST /auth/login/verify`）。
 * 也就是说：密码对了但码没过，客户端手里没有任何可用凭据 —— 否则「密码泄露」就已经
 * 等于「账号到手」，两步验证只是多一步表演。
 */

import { state, whenReady } from '../core/bridge.js';
import { auth } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { toast } from '../ui/components.js';
import { el, append } from '../core/dom.js';
import {
    fieldValidator, validateAll, limit, PATTERNS,
} from '../core/validate.js';

export async function loginPage(context) {
    const body = scaffold({
        title: t('s_1yggxgd'),
        showBack: false,
        bodyProps: { 'data-gap': 'tight' },
        children: [],
    });

    // ── 第一步：账号与密码 ────────────────────────────────────────
    const form = el('form', { class: 'form', novalidate: true });
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cta', type: 'submit' }, [t('s_1yggxgd')]);
    const guest = el('button', { class: 'cta ghost', type: 'button' }, [t('s_1jfbdwq')]);

    const account = el('input', {
        class: 'input',
        id: 'login-account',
        type: 'text',
        // 后端支持用户名或**已验证邮箱**登录（routes/auth.js 的 OR 查询），
        // 占位符以前写的是「昵称 / 邮箱」—— 昵称没有唯一约束、根本没法用来登录。
        placeholder: t('s_1sqr282'),
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
    // 上限取 120 而不是用户名的 20：这个框也能填邮箱，卡在 20 会把长邮箱直接挡在前面。
    const validators = [
        fieldValidator({ control: account, label: t('s_yuxvje'), required: true, max: 120 }),
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

    // 第一步才有意义的两块：示例账号提示与「注册 / 忘记密码」入口
    const stepOneExtras = el('div', { class: 'stack', 'data-gap': 'sm' }, [
        el('div', { class: 'notice' }, [
            el('span', {
                text: '演示账号：demo / exhibitor / user，密码均为 password',
            }),
        ]),
        el('footer', {
            class: 'row',
            style: { justifyContent: 'center', padding: 'var(--s3)' },
        }, [
            el('span', { class: 'dim', text: t('s_und5qj') }),
            el('button', {
                class: 'text-action',
                type: 'button',
                onclick: () => context.navigate('register'),
            }, [t('s_1fwr1ko')]),
        ]),
        // 忘记密码：邮箱收验证码 → 设置新密码。放在登录入口旁边，找不回来的人才找得到。
        el('div', {
            class: 'row',
            style: { justifyContent: 'center', padding: '0 var(--s3)' },
        }, [
            el('button', {
                class: 'text-action',
                type: 'button',
                onclick: () => context.navigate('forgot-password'),
            }, [t('s_5re2h1')]),
        ]),
    ]);
    append(body, [stepOneExtras]);

    // ── 第二步：两步验证 ──────────────────────────────────────────
    const verifyForm = el('form', { class: 'form', novalidate: true, hidden: true });
    const maskedEmail = el('strong', { text: '' });
    const codeInput = el('input', {
        class: 'input',
        id: 'login-code',
        type: 'text',
        placeholder: t('s_doboo3'),
        autocomplete: 'one-time-code',
    });
    codeInput.setAttribute('inputmode', 'numeric');
    codeInput.setAttribute('maxlength', '6');
    const verifyError = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const verifySubmit = el('button', { class: 'cta', type: 'submit' }, [t('s_rvg0ck')]);
    const resend = el('button', { class: 'cta ghost', type: 'button' }, [t('s_1fyr64c')]);
    const back = el('button', { class: 'cta ghost', type: 'button' }, [t('s_knqdo0')]);

    append(verifyForm, [
        el('div', { class: 'stack', 'data-gap': 'sm' }, [
            el('h2', { text: t('s_15msj8x') }),
            // 冒号而不是尾随空格：Android 的 string 资源会裁掉首尾空白
            el('p', { class: 'muted' }, [t('s_sg8u9h'), maskedEmail]),
            el('p', { class: 'field-hint', text: t('s_1xtehpy') }),
        ]),
        el('div', { class: 'field' }, [
            el('label', { for: 'login-code', text: t('s_s8pbve') }),
            codeInput,
        ]),
        verifyError,
        verifySubmit,
        resend,
        back,
    ]);
    append(body, [verifyForm]);

    /** 预认证票：第二步与重发都要用它；它本身不是登录凭据。 */
    let ticket = '';
    let timer = null;
    let remaining = 0;

    function showStep(step) {
        form.hidden = step !== 1;
        stepOneExtras.hidden = step !== 1;
        verifyForm.hidden = step !== 2;
        errorBox.hidden = true;
        verifyError.hidden = true;
        if (step === 2) {
            codeInput.focus?.();
        } else {
            stopCountdown();
        }
    }

    function startCountdown(seconds) {
        stopCountdown();
        remaining = Number(seconds) > 0 ? Number(seconds) : 60;
        paintResend();
        timer = setTimeout(tick, 1000);
    }

    function tick() {
        remaining -= 1;
        paintResend();
        if (remaining > 0) {
            timer = setTimeout(tick, 1000);
        } else {
            timer = null;
        }
    }

    function paintResend() {
        resend.disabled = remaining > 0;
        const ready = t('s_1fyr64c');
        const waiting = t('s_1qbu9z0');
        resend.textContent = remaining > 0 ? `${remaining} ${waiting}` : ready;
    }

    function stopCountdown() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        remaining = 0;
        resend.disabled = false;
        resend.textContent = t('s_1fyr64c');
    }

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

    /** 进入登录态之后的收尾：写用户态、提示、跳回原页面。 */
    function enterAs(user) {
        Object.assign(state.user, user || {});
        stopCountdown();
        toast(`欢迎回来，${state.user.nickname || state.user.username}`, 'success');
        context.navigate(context.params.redirect || 'home', redirectParams(), { replace: true });
    }

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
            if (result.twoFactorRequired) {
                // 这一步没有令牌：只有一张票 + 一封刚发出的验证码邮件
                ticket = result.ticket || '';
                maskedEmail.textContent = result.maskedEmail || '';
                codeInput.value = '';
                showStep(2);
                startCountdown(result.resendAfterSec);
                return;
            }
            enterAs(result.user);
        } catch (error) {
            showError(error.message);
        } finally {
            submit.dataset.loading = 'false';
            submit.disabled = false;
        }
    });

    verifyForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        verifyError.hidden = true;
        const checked = validateAll([
            fieldValidator({
                control: codeInput,
                label: t('s_s8pbve'),
                required: true,
                pattern: PATTERNS.verificationCode,
                patternMessage: t('s_1x20l1k'),
            }),
        ]);
        if (!checked.ok) {
            verifyError.textContent = checked.message;
            verifyError.hidden = false;
            checked.validator?.focus?.();
            return;
        }
        verifySubmit.dataset.loading = 'true';
        verifySubmit.disabled = true;
        try {
            const verified = await auth.loginVerify({ ticket, code: codeInput.value.trim() });
            if (!verified?.ok) {
                verifyError.textContent = verified?.error || t('s_rn5blf');
                verifyError.hidden = false;
                return;
            }
            enterAs(verified.user);
        } catch (error) {
            verifyError.textContent = error.message;
            verifyError.hidden = false;
        } finally {
            verifySubmit.dataset.loading = 'false';
            verifySubmit.disabled = false;
        }
    });

    resend.addEventListener('click', async () => {
        if (!ticket) {
            return;
        }
        verifyError.hidden = true;
        resend.disabled = true;
        try {
            const sent = await auth.loginCode(ticket);
            if (!sent?.ok) {
                verifyError.textContent = sent?.error || t('s_rn5blf');
                verifyError.hidden = false;
                resend.disabled = false;
                return;
            }
            toast(t('s_5rsk4v'), 'success');
            startCountdown(sent.resendAfterSec);
        } catch (error) {
            verifyError.textContent = error.message;
            verifyError.hidden = false;
            resend.disabled = false;
        }
    });

    back.addEventListener('click', () => {
        ticket = '';
        showStep(1);
    });

    function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
    }
}
