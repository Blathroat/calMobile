<script setup lang="ts">
/**
 * 报名站的兜底页：地址对不上任何报名链接时停在这里。
 * 不提供展会列表或日历，只把人送去登录或「我的报名」。
 */
import { useRouter } from 'vue-router';
import { paths } from '@/app/surface';
import { useSessionStore } from '@/stores/session';
import StateBlock from '@/components/StateBlock.vue';
import { t } from '@/i18n';

const router = useRouter();
const session = useSessionStore();

const title = t('s_14frgky');
const description = t('s_qbzw14');

function next(): void {
  void router.push(session.loggedIn ? paths.registrations : '/login');
}
</script>

<template>
  <StateBlock
    icon="info"
    :title="title"
    :description="description"
    :action-label="session.loggedIn ? t('s_1m2dh8u') : t('s_533bde')"
    @action="next"
  />
</template>
