/**
 * 屏幕 05 · 注册（创建账号）
 * 线框：newUI/remaining-ui.html #screen-register-account
 * 业务：AuthManager.register（用户名、密码、邮箱校验）。
 *
 * 校验规则来自「管理-设置」里的服务器设置：用户名长度区间、密码长度区间与邮箱格式，
 * 前端即时提示，原生侧保存前再校验一次，避免绕过页面直接调用桥接。
 */

import { call, state } from '../core/bridge.js';
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
    const body = scaffold({ title: '注册', backTo: 'login', children: [] });

    append(body, el('div', { class: 'stack', 'data-gap': 'sm' }, [
        el('h2', { text: '创建你的展会档案' }),
        el('p', { class: 'muted', text: '几步完成，马上开始安排你的展会之旅' }),
    ]));

    const form = el('form', { class: 'form', novalidate: true });
    const errorBox = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'cta', type: 'submit' }, ['创建账号']);

    const username = input('register-username', 'text', '设置用户名', 'username');
    const email = input('register-email', 'email', '输入常用邮箱', 'email');
    const password = input('register-password', 'password', '设置登录密码', 'new-password');
    const confirm = input('register-confirm', 'password', '再次输入密码', 'new-password');
    const strength = el('span', { class: 'password-meter', dataset: { level: '0' }, text: '未填写' });

    const account = usernameRule();
    const secret = passwordRule();

    const validators = [
        fieldValidator({ control: username, required: true, ...account }),
        fieldValidator({
            control: email,
            label: '邮箱',
            required: true,
            max: 60,
            pattern: PATTERNS.email,
            patternMessage: '邮箱格式不正确',
        }),
        fieldValidator({
            control: password,
            required: true,
            min: secret.min,
            max: secret.max,
            custom: matchRule(password, confirm),
        }),
        fieldValidator({ control: confirm, label: '确认密码', required: true, max: secret.max }),
    ];

    // 密码强度只做提示，不参与拦截。
    password.addEventListener('input', () => {
        const result = passwordStrength(password.value);
        strength.textContent = result.label;
        strength.dataset.level = String(result.level);
    });

    append(form, [
        field(`用户名（${account.min}–${account.max} 个字符）`, username, '可用中英文、数字与下划线'),
        field('邮箱', email),
        field(`密码（${secret.min}–${secret.max} 个字符）`, password, `至少 ${secret.min} 个字符`),
        field('确认密码', confirm),
        el('div', { class: 'row', 'data-between': 'true' }, [
            el('span', { class: 'row-meta', text: '密码强度' }),
            strength,
        ]),
        errorBox,
        submit,
    ]);
    append(body, [form]);

    append(body, el('button', {
        class: 'cta ghost',
        type: 'button',
        onclick: () => context.navigate('login', {}, { replace: true }),
    }, ['已有账号？返回登录']));

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
            const saved = await auth.register({
                username: username.value.trim(),
                email: email.value.trim(),
                password: password.value,
                confirmPassword: confirm.value,
            });
            if (!saved?.ok) {
                return showError(saved?.error || '注册失败');
            }
            Object.assign(state.user, saved.user || {});
            toast('账号已创建，已为你登录', 'success');
            context.navigate('home', {}, { replace: true });
        } catch (error) {
            showError(error.message);
        } finally {
            submit.dataset.loading = 'false';
            submit.disabled = false;
        }
    });

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
