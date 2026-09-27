<script setup lang="ts">
import { ref } from 'vue'; import { api } from '@/app/runtime'; import { device } from '@/services/device-services';
const code = ref(''); const message = ref(''); const error = ref(''); const busy = ref(false);
async function scan() { error.value = ''; try { await device.ensureCameraPermission(); message.value = '摄像头已授权，请使用扫码模块读取报名码'; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } }
async function check() { error.value = ''; busy.value = true; try { await api.checkIn(code.value.trim()); message.value = '核销成功'; } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } finally { busy.value = false; } }
</script>
<template><section class="page"><h1>现场核销</h1><article class="card form"><button class="cta ghost" @click="scan">打开摄像头</button><label>报名码<input v-model="code" autocomplete="off"></label><button class="cta" :disabled="busy || !code" @click="check">核销</button><p v-if="message" class="notice">{{ message }}</p><p v-if="error" class="error">{{ error }}</p></article></section></template>
