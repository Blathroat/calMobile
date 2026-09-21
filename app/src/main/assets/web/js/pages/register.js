import { t } from '../core/strings.js';
/**
 * 屏幕 05 · 注册（创建账号）
 * 线框：docs/newUI/remaining-ui.html #screen-register-account
 * 业务：POST /auth/register（第一步：校验 + 发码）→ POST /auth/register/verify（第二步：验证码通过才建号）
 *
 * 两步的意义在**后端**：邮箱验证通过之前不会创建账号，所以库里不会留下「注册了但邮箱
 * 没验证」的半成品，也就不用为那种状态设计一整套功能限制。第一步的待建账号（密码已经是
 * 哈希）暂存在验证码记录里，10 分钟不验证就随过期码一起消失。
 *
 * 校验规则来自「管理-设置」里的服务器设置（bootstrap 下发的 `state.limits`）：用户名与
 * 密码的长度区间由 `usernameRule()` / `passwordRule()` 读取，前端即时提示；
 * 保存前后端会再校验一次（server/src/routes/auth.js），绕过页面直接调接口同样被拦。
 */

import { state } from '../core/bridge.js';
import { auth } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { toast } from '../ui/components.js';
import { el, append } from '../core/dom.js';
import {
    fieldValidator,
    validateAll,
    usernameRule,
    passwordRule,
    passwordStrength,
    matchRule,
    PATTERNS,
} from '../core/validate.js';

export async function registerPage(context) {
    const body = scaffold({ title: t('s_1n008jl'), backTo: 'login', children: [] });

    append(body, el('div', { class: 'stack', 'data-gap': 'sm' }, [
        el('h2', { text: t('s_1dixw2w') }),
        el('p', { class: 'muted', text: t('s_m8zmid') }),
    ]));

    // ── 第一步：账号信息 ──────────────────────────────────────────
    const form = el('form', { class: 'form', novalidate: true });
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cta', type: 'submit' }, [t('s_n6lkn3')]);

    const username = input('register-username', 'text', t('s_doztlr'), 'username');
    const email = input('register-email', 'email', t('s_1i2pkg8'), 'email');
    const password = input('register-password', 'password', t('s_8eggh4'), 'new-password');
    const confirm = input('register-confirm', 'password', t('s_1ceimwm'), 'new-password');
    const strength = el('span', { class: 'password-meter', dataset: { level: '0' }, text: t('s_15h5nhd') });

    const account = usernameRule();
    const secret = passwordRule();

    const validators = [
        fieldValidator({ control: username, required: true, ...account }),
        fieldValidator({
            control: email,
            label: t('s_185tvls'),
            required: true,
            max: 60,
            pattern: PATTERNS.email,
            patternMessage: t('s_1u3yg0h'),
        }),
        fieldValidator({
            control: password,
            required: true,
            min: secret.min,
            max: secret.max,
            custom: matchRule(password, confirm),
        }),
        fieldValidator({ control: confirm, label: t('s_ocmice'), required: true, max: secret.max }),
    ];

    // 密码强度只做提示，不参与拦截。
    password.addEventListener('input', () => {
        const result = passwordStrength(password.value);
        strength.textContent = result.label;
        strength.dataset.level = String(result.level);
    });

    append(form, [
        field(`用户名（${account.min}–${account.max} 个字符）`, username, t('s_7tkrpl')),
        field(t('s_185tvls'), email),
        field(`密码（${secret.min}–${secret.max} 个字符）`, password, `至少 ${secret.min} 个字符`),
        field(t('s_ocmice'), confirm),
        el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: t('s_1lj253k') }),
            strength,
        ]),
        errorBox,
        submit,
    ]);

    // ── 第二步：邮箱验证码 ────────────────────────────────────────
    const verifyForm = el('form', { class: 'form', novalidate: true, hidden: true });
    const sentTo = el('strong', { text: '' });
    const codeInput = input('register-code', 'text', t('s_doboo3'), 'one-time-code');
    codeInput.setAttribute('inputmode', 'numeric');
    codeInput.setAttribute('maxlength', '6');
    const verifyError = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const verifySubmit = el('button', { class: 'cta', type: 'submit' }, [t('s_1jikdwu')]);
    const resend = el('button', { class: 'cta ghost', type: 'button' }, [t('s_1fyr64c')]);
    const back = el('button', { class: 'cta ghost', type: 'button' }, [t('s_177p9jq')]);

    append(verifyForm, [
        el('div', { class: 'stack', 'data-gap': 'sm' }, [
            // 冒号而不是尾随空格：Android 的 string 资源会裁掉首尾空白，
            // 「验证码已发送到 」+ 邮箱在真机上会粘成「验证码已发送到xxx@…」。
            el('p', { class: 'muted' }, [t('s_sg8u9h'), sentTo]),
            el('p', { class: 'field-hint', text: t('s_1v481a9') }),
        ]),
        field(t('s_s8pbve'), codeInput),
        verifyError,
        verifySubmit,
        resend,
        back,
    ]);

    append(body, [form, verifyForm]);

    append(body, el('button', {
        class: 'cta ghost',
        type: 'button',
        onclick: () => context.navigate('login', {}, { replace: true }),
    }, [t('s_1smt94y')]));

    /** 第一步提交过的入参：重发与「返回修改」都要用它。 */
    let pending = null;
    let timer = null;
    let remaining = 0;

    /** 切到某一步：只切显隐，不重建 DOM（已填的内容因此不会丢）。 */
    function showStep(step) {
        form.hidden = step !== 1;
        verifyForm.hidden = step !== 2;
        errorBox.hidden = true;
        verifyError.hidden = true;
        if (step === 2) {
            codeInput.focus?.();
        } else {
            stopCountdown();
        }
    }

    /** 重发倒计时：按钮上的秒数与后端的 60 秒冷却保持一致。 */
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

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const result = validateAll(validators);
        if (!result.ok) {
            return showError(result.message, result.validator);
        }
        submit.dataset.loading = 'true';
        submit.disabled = true;
        try {
            const payload = {
                username: username.value.trim(),
                email: email.value.trim(),
                password: password.value,
                confirmPassword: confirm.value,
            };
            const sent = await auth.register(payload);
            if (!sent?.ok) {
                return showError(sent?.error || t('s_osck6n'));
            }
            // 这一步后端没建账号，只回了「码发到哪、多久过期、多久能重发」。
            pending = payload;
            sentTo.textContent = sent.email || payload.email;
            codeInput.value = '';
            showStep(2);
            startCountdown(sent.resendAfterSec);
            toast(t('s_5rsk4v'), 'success');
        } catch (error) {
            showError(error.message);
        } finally {
            submit.dataset.loading = 'false';
            submit.disabled = false;
        }
        return undefined;
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
            const saved = await auth.registerVerify({
                email: pending?.email || email.value.trim(),
                code: codeInput.value.trim(),
            });
            if (!saved?.ok) {
                verifyError.textContent = saved?.error || t('s_osck6n');
                verifyError.hidden = false;
                return;
            }
            Object.assign(state.user, saved.user || {});
            stopCountdown();
            toast(t('s_6e6nd9'), 'success');
            context.navigate('home', {}, { replace: true });
        } catch (error) {
            verifyError.textContent = error.message;
            verifyError.hidden = false;
        } finally {
            verifySubmit.dataset.loading = 'false';
            verifySubmit.disabled = false;
        }
        return undefined;
    });

    resend.addEventListener('click', async () => {
        if (!pending) {
            return;
        }
        verifyError.hidden = true;
        resend.disabled = true;
        try {
            const sent = await auth.register(pending);
            if (!sent?.ok) {
                verifyError.textContent = sent?.error || t('s_osck6n');
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

    back.addEventListener('click', () => showStep(1));

    function showError(message, validator) {
        errorBox.textContent = message;
        errorBox.hidden = false;
        validator?.focus?.();
    }

    function input(id, type, placeholder, autocomplete) {
        return el('input', { class: 'input', id, type, placeholder, autocomplete });
    }

    function field(label, control, hint) {
        return el('div', { class: 'field' }, [
            el('label', { for: control.id, text: label }),
            control,
            hint ? el('p', { class: 'field-hint', text: hint }) : null,
        ]);
    }
}
