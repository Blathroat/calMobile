<script setup lang="ts">
import { ref } from 'vue'; import { useRouter } from 'vue-router'; import { api } from '@/app/runtime';
import { t } from '@/i18n';
const router = useRouter(); const email = ref(''); const code = ref(''); const password = ref(''); const sent = ref(false); const error = ref('');
async function submitRequest() { error.value = ''; try { await api.auth.forgotPassword(email.value); sent.value = true; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function reset() { error.value = ''; try { await api.auth.resetPassword({ email: email.value, code: code.value, password: password.value }); await router.replace('/login'); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page auth-page"><header class="page-heading"><h1>{{ t('s_1qksguo') }}</h1></header><form class="card form" @submit.prevent="sent ? reset() : submitRequest"><label>{{ t('s_185tvls') }}<input v-model="email" type="email" required></label><template v-if="sent"><label>{{ t('s_s8pbve') }}<input v-model="code" required inputmode="numeric"></label><label>{{ t('s_8eggh4') }}<input v-model="password" type="password" required></label></template><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta">{{ sent ? t('s_ww6ehr') : t('s_shrzdv') }}</button><button type="button" class="text-action" @click="router.back()">{{ t('s_omytgn') }}</button></form></section></template>
