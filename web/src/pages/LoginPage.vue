<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
const router = useRouter(); const route = useRoute(); const session = useSessionStore();
const account = ref(''); const password = ref(''); const code = ref(''); const ticket = ref(''); const error = ref(''); const verifying = ref(false); const busy = ref(false); const resendBusy = ref(false);
function redirect() { void router.replace(String(route.query.redirect || '/home')); }
async function submit() { error.value = ''; busy.value = true; try { const result = await api.auth.login(account.value.trim(), password.value); if (result.twoFactorRequired) { ticket.value = String(result.ticket ?? ''); verifying.value = true; return; } session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
async function verify() { error.value = ''; busy.value = true; try { const result = await api.auth.loginVerify({ ticket: ticket.value, code: code.value.trim() }); session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
async function resend() { if (!ticket.value) return; resendBusy.value = true; error.value = ''; try { await api.auth.loginCode(ticket.value); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { resendBusy.value = false; } }
async function guest() { busy.value = true; error.value = ''; try { const result = await api.auth.guest(); session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
</script>
<template>
  <section class="page auth-page"><header class="page-heading"><p class="eyebrow">calMobile</p><h1>登录</h1></header>
    <form v-if="!verifying" class="card form" @submit.prevent="submit"><label>用户名或已验证邮箱<input v-model="account" autocomplete="username" required maxlength="120"></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required></label><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta" :disabled="busy">登录</button><button type="button" class="cta ghost" :disabled="busy" @click="guest">游客浏览</button><button type="button" class="text-action" @click="router.push('/register')">注册账号</button><button type="button" class="text-action" @click="router.push('/forgot-password')">忘记密码</button></form>
    <form v-else class="card form" @submit.prevent="verify"><h2>完成两步验证</h2><label>验证码<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12"></label><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta" :disabled="busy">验证并登录</button><button type="button" class="cta ghost" :disabled="resendBusy" @click="resend">重新发送验证码</button><button type="button" class="text-action" @click="verifying = false">返回</button></form>
  </section>
</template>
