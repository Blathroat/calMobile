<script setup lang="ts">
import { t } from '@/i18n';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import type { JsonObject } from '@/api/types';
const router = useRouter(); const query = useAsync<JsonObject>(); const enabled = computed(() => query.data.value?.enabled === true); const code = ref(''); const password = ref(''); const error = ref(''); const message = ref('');
onMounted(() => query.run(() => api.security.get()));
async function enable() { error.value = ''; message.value = ''; try { await api.security.enableTwoFactor(); message.value = t('s_5rsk4v'); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function verify() { error.value = ''; try { await api.security.verifyTwoFactor(code.value); message.value = t('s_14jjxmk'); await query.run(() => api.security.get()); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function disable() { error.value = ''; try { await api.security.disableTwoFactor(password.value); message.value = t('s_gupxm1'); await query.run(() => api.security.get()); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page"><button class="text-action" @click="router.back()">{{ t('s_omytgn') }}</button><h1>{{ t('s_1iiaolc') }}</h1><div v-if="query.loading" class="state">{{ t('s_zw67ah') }}</div><article v-else class="card form"><p>{{ t('s_1apxo2s') }}{{ enabled ? t('s_zjmqjk') : t('s_oxxuyg') }}</p><button v-if="!enabled" class="cta" @click="enable">{{ t('s_shrzdv') }}</button><label v-if="!enabled">{{ t('s_jyzd1p') }}<input v-model="code" inputmode="numeric"></label><button v-if="!enabled" class="cta ghost" @click="verify">{{ t('s_1jjtbcm') }}</button><label v-else>{{ t('s_1q7kb1c') }}<input v-model="password" type="password"></label><button v-if="enabled" class="cta ghost" @click="disable">{{ t('s_p1k61') }}</button><p v-if="message" class="notice">{{ message }}</p><p v-if="error" class="error">{{ error }}</p></article></section></template>
