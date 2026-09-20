import { t } from '../core/strings.js';
/**
 * 屏幕 06 · 找回密码
 * 业务：POST /auth/password/forgot（发码）→ POST /auth/password/reset（验证码 + 新密码）
 *
 * 后端**不区分「这个邮箱注册过没有」**：两种情况响应完全一致，所以这里的提示必须写成
 * 「如果该邮箱已注册，验证码会发送到该邮箱」。写成「已发送」的话，填错邮箱的用户会一直等
 * 一封永远不会来的邮件 —— 而「某个邮箱是否注册过」本来就不该被这个接口透露出去。
 *
 * 两步同页：第一步只要邮箱，第二步要验证码与新密码；重置成功后后端会撤销该用户全部刷新令牌，
 * 所以回到登录页重新登录是必须的（其它设备上的登录状态也一并失效）。
 */

import { auth } from '../core/api.js';
import { scaffold } from '../core/router.js';
import { toast } from '../ui/components.js';
import { el, append } from '../core/dom.js';
import {
    fieldValidator,
    validateAll,
    passwordRule,
    matchRule,
    PATTERNS,
} from '../core/validate.js';

export async function forgotPasswordPage(context) {
    const body = scaffold({ title: t('s_1qksguo'), backTo: 'login', children: [] });

    append(body, el('div', { class: 'stack', 'data-gap': 'sm' }, [
        el('h2', { text: t('s_ww6ehr') }),
        el('p', { class: 'muted', text: t('s_1ro3s85') }),
    ]));

    // ── 第一步：邮箱 ──────────────────────────────────────────────
    const form = el('form', { class: 'form', novalidate: true });
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cta', type: 'submit' }, [t('s_shrzdv')]);
    const email = input('forgot-email', 'email', t('s_1i2pkg8'), 'email');

    append(form, [
        field(t('s_1csq350'), email, t('s_1de7lo')),
        errorBox,
        submit,
    ]);

    // ── 第二步：验证码 + 新密码 ───────────────────────────────────
    const resetForm = el('form', { class: 'form', novalidate: true, hidden: true });
    const sentTo = el('strong', { text: '' });
    const codeInput = input('forgot-code', 'text', t('s_doboo3'), 'one-time-code');
    codeInput.setAttribute('inputmode', 'numeric');
    codeInput.setAttribute('maxlength', '6');
    const password = input('forgot-password', 'password', t('s_8eggh4'), 'new-password');
    const confirm = input('forgot-confirm', 'password', t('s_1ceimwm'), 'new-password');
    const resetError = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const resetSubmit = el('button', { class: 'cta', type: 'submit' }, [t('s_szog53')]);
    const resend = el('button', { class: 'cta ghost', type: 'button' }, [t('s_1fyr64c')]);
    const back = el('button', { class: 'cta ghost', type: 'button' }, [t('s_9cd546')]);

    const secret = passwordRule();

    append(resetForm, [
        el('div', { class: 'stack', 'data-gap': 'sm' }, [
            // 冒号而不是尾随空格：Android 的 string 资源会裁掉首尾空白。
            el('p', { class: 'muted' }, [t('s_15so5xh'), sentTo]),
            el('p', { class: 'field-hint', text: t('s_1n9i5np') }),
        ]),
        field(t('s_s8pbve'), codeInput),
        field(`新密码（${secret.min}–${secret.max} 个字符）`, password),
        field(t('s_ocmice'), confirm),
        resetError,
        resetSubmit,
        resend,
        back,
    ]);

    append(body, [form, resetForm]);

    append(body, el('button', {
        class: 'cta ghost',
        type: 'button',
        onclick: () => context.navigate('login', {}, { replace: true }),
    }, [t('s_1smt94y')]));

    /** 第一步输入过的邮箱：重发与「换一个邮箱」都要用。 */
    let pendingEmail = '';
    let timer = null;
    let remaining = 0;

    function showStep(step) {
        form.hidden = step !== 1;
        resetForm.hidden = step !== 2;
        errorBox.hidden = true;
        resetError.hidden = true;
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

    /** 请求发码：成功后进第二步并开始倒计时。 */
    async function requestCode(target, onError) {
        const sent = await auth.forgotPassword(target);
        if (!sent?.ok) {
            onError(sent?.error || t('s_osck6n'));
            return false;
        }
        pendingEmail = target;
        sentTo.textContent = target;
        showStep(2);
        startCountdown(sent.resendAfterSec);
        return true;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const checked = validateAll([
            fieldValidator({
                control: email,
                label: t('s_185tvls'),
                required: true,
                max: 120,
                pattern: PATTERNS.email,
                patternMessage: t('s_1u3yg0h'),
            }),
        ]);
        if (!checked.ok) {
            errorBox.textContent = checked.message;
            errorBox.hidden = false;
            checked.validator?.focus?.();
            return;
        }
        submit.dataset.loading = 'true';
        submit.disabled = true;
        try {
            await requestCode(email.value.trim(), (message) => {
                errorBox.textContent = message;
                errorBox.hidden = false;
            });
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            submit.dataset.loading = 'false';
            submit.disabled = false;
        }
    });

    resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        resetError.hidden = true;
        const checked = validateAll([
            fieldValidator({
                control: codeInput,
                label: t('s_s8pbve'),
                required: true,
                pattern: PATTERNS.verificationCode,
                patternMessage: t('s_1x20l1k'),
            }),
            fieldValidator({
                control: password,
                required: true,
                min: secret.min,
                max: secret.max,
                custom: matchRule(password, confirm),
            }),
            fieldValidator({ control: confirm, label: t('s_ocmice'), required: true, max: secret.max }),
        ]);
        if (!checked.ok) {
            resetError.textContent = checked.message;
            resetError.hidden = false;
            checked.validator?.focus?.();
            return;
        }
        resetSubmit.dataset.loading = 'true';
        resetSubmit.disabled = true;
        try {
            const result = await auth.resetPassword({
                email: pendingEmail || email.value.trim(),
                code: codeInput.value.trim(),
                newPassword: password.value,
                confirmPassword: confirm.value,
            });
            if (!result?.ok) {
                resetError.textContent = result?.error || t('s_osck6n');
                resetError.hidden = false;
                return;
            }
            stopCountdown();
            toast(t('s_j08rvp'), 'success');
            context.navigate('login', {}, { replace: true });
        } catch (error) {
            resetError.textContent = error.message;
            resetError.hidden = false;
        } finally {
            resetSubmit.dataset.loading = 'false';
            resetSubmit.disabled = false;
        }
    });

    resend.addEventListener('click', async () => {
        if (!pendingEmail) {
            return;
        }
        resetError.hidden = true;
        resend.disabled = true;
        try {
            await requestCode(pendingEmail, (message) => {
                resetError.textContent = message;
                resetError.hidden = false;
            });
            if (remaining > 0) {
                toast(t('s_5rsk4v'), 'success');
            }
        } catch (error) {
            resetError.textContent = error.message;
            resetError.hidden = false;
            resend.disabled = false;
        }
    });

    back.addEventListener('click', () => showStep(1));

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
