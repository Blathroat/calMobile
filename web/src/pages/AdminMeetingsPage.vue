<script setup lang="ts">
/**
 * 管理员查看某一位展商的私人会议。
 *
 * 列表与展商自己的私人会议页相同。待审核是通过和拒绝，审完后是查看详情。
 * 限制会议和删除会议在详情抽屉里。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import MeetingInbox from '@/components/MeetingInbox.vue';

const route = useRoute();
const exhibitorId = computed(() => String(route.params.exhibitorId ?? ''));
</script>

<template>
  <MeetingInbox mode="admin" :exhibitor-id="exhibitorId" />
</template>
