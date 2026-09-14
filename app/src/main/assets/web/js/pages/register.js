/**
 * 屏幕 05 · 注册（创建账号）
 * 线框：newUI/remaining-ui.html #screen-register-account
 * 业务：AuthManager.register（用户名、密码、邮箱校验）。
 */

import { call, state } from '../core/bridge.js';
import { scaffold } from '../core/router.js';
import { toast } from '../ui/components.js';
import { el, append } from '../core/dom.js';

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

    append(form, [
        field('用户名', username),
        field('邮箱', email),
        field('密码', password, '至少 4 个字符'),
        field('确认密码', confirm),
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
        const values = {
            username: username.value.trim(),
            email: email.value.trim(),
            password: password.value,
            confirmPassword: confirm.value,
        };
        if (!values.username) {
            return showError('请输入用户名');
        }
        if (!values.email) {
            return showError('请输入邮箱');
        }
        if (values.password.length < 4) {
            return showError('密码至少需要 4 个字符');
        }
        if (values.password !== values.confirmPassword) {
            return showError('两次输入的密码不一致');
        }
        submit.dataset.loading = 'true';
        submit.disabled = true;
        try {
            const result = await call('auth.register', values);
            if (!result?.ok) {
                return showError(result?.error || '注册失败');
            }
            Object.assign(state.user, result.user || {});
            toast('账号已创建，已为你登录', 'success');
            context.navigate('home', {}, { replace: true });
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
