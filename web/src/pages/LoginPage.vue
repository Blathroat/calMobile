<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '@/app/runtime';
import { useSessionStore } from '@/stores/session';
import { t } from '@/i18n';
const router = useRouter(); const route = useRoute(); const session = useSessionStore();
const account = ref(''); const password = ref(''); const code = ref(''); const ticket = ref(''); const error = ref(''); const verifying = ref(false); const busy = ref(false); const resendBusy = ref(false);
function redirect() { void router.replace(String(route.query.redirect || '/home')); }
async function submit() { error.value = ''; busy.value = true; try { const result = await api.auth.login(account.value.trim(), password.value); if (result.twoFactorRequired) { ticket.value = String(result.ticket ?? ''); verifying.value = true; return; } session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
async function verify() { error.value = ''; busy.value = true; try { const result = await api.auth.loginVerify({ ticket: ticket.value, code: code.value.trim() }); session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
async function resend() { if (!ticket.value) return; resendBusy.value = true; error.value = ''; try { await api.auth.loginCode(ticket.value); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { resendBusy.value = false; } }
async function guest() { busy.value = true; error.value = ''; try { const result = await api.auth.guest(); session.applyUser(result.user as Record<string, unknown> | undefined); redirect(); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
</script>
<template>
  <section class="page auth-page"><header class="page-heading"><p class="eyebrow">calMobile</p><h1>{{ t('s_1yggxgd') }}</h1></header>
    <form v-if="!verifying" class="card form" @submit.prevent="submit"><label>{{ t('s_237i7x') }}<input v-model="account" autocomplete="username" required maxlength="120"></label><label>{{ t('s_1aph6eg') }}<input v-model="password" type="password" autocomplete="current-password" required></label><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta" :disabled="busy">{{ t('s_1yggxgd') }}</button><button type="button" class="cta ghost" :disabled="busy" @click="guest">{{ t('s_atle2w') }}</button><button type="button" class="text-action" @click="router.push('/register')">{{ t('s_36xms6') }}</button><button type="button" class="text-action" @click="router.push('/forgot-password')">{{ t('s_12sazo8') }}</button></form>
    <form v-else class="card form" @submit.prevent="verify"><h2>{{ t('s_11xmrmt') }}</h2><label>{{ t('s_s8pbve') }}<input v-model="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12"></label><p v-if="error" class="error" role="alert">{{ error }}</p><button class="cta" :disabled="busy">{{ t('s_rvg0ck') }}</button><button type="button" class="cta ghost" :disabled="resendBusy" @click="resend">{{ t('s_1fyr64c') }}</button><button type="button" class="text-action" @click="verifying = false">{{ t('s_omytgn') }}</button></form>
  </section>
</template>
