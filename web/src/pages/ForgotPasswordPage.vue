<script setup lang="ts">
import { ref } from 'vue'; import { useRouter } from 'vue-router'; import { api } from '@/app/runtime';
const router = useRouter(); const email = ref(''); const code = ref(''); const password = ref(''); const sent = ref(false); const error = ref('');
async function submitRequest() { error.value = ''; try { await api.auth.forgotPassword(email.value); sent.value = true; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function reset() { error.value = ''; try { await api.auth.resetPassword({ email: email.value, code: code.value, password: password.value }); await router.replace('/login'); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page auth-page"><header class="page-heading"><h1>找回密码</h1></header><form class="card form" @submit.prevent="sent ? reset() : submitRequest"><label>邮箱<input v-model="email" type="email" required></label><template v-if="sent"><label>验证码<input v-model="code" required inputmode="numeric"></label><label>新密码<input v-model="password" type="password" required></label></template><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta">{{ sent ? '重置密码' : '发送验证码' }}</button><button type="button" class="text-action" @click="router.back()">返回</button></form></section></template>
