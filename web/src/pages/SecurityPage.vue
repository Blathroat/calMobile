<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import type { JsonObject } from '@/api/types';
const router = useRouter(); const query = useAsync<JsonObject>(); const enabled = computed(() => query.data.value?.enabled === true); const code = ref(''); const password = ref(''); const error = ref(''); const message = ref('');
onMounted(() => query.run(() => api.security.get()));
async function enable() { error.value = ''; message.value = ''; try { await api.security.enableTwoFactor(); message.value = '验证码已发送'; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function verify() { error.value = ''; try { await api.security.verifyTwoFactor(code.value); message.value = '两步验证已开启'; await query.run(() => api.security.get()); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function disable() { error.value = ''; try { await api.security.disableTwoFactor(password.value); message.value = '两步验证已关闭'; await query.run(() => api.security.get()); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
</script>
<template><section class="page"><button class="text-action" @click="router.back()">返回</button><h1>安全设置</h1><div v-if="query.loading" class="state">正在加载…</div><article v-else class="card form"><p>两步验证当前{{ enabled ? '已开启' : '未开启' }}</p><button v-if="!enabled" class="cta" @click="enable">发送验证码</button><label v-if="!enabled">验证码<input v-model="code" inputmode="numeric"></label><button v-if="!enabled" class="cta ghost" @click="verify">确认开启</button><label v-else>当前密码<input v-model="password" type="password"></label><button v-if="enabled" class="cta ghost" @click="disable">关闭两步验证</button><p v-if="message" class="notice">{{ message }}</p><p v-if="error" class="error">{{ error }}</p></article></section></template>
