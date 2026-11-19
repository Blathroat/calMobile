<script setup lang="ts">
/**
 * 用户设置里的资料表单内容；抽屉标题和保存 / 取消动作由全局 AppSheet 负责。
 *
 * 头像块只放在抽屉最上方，且只给本人：管理员代改别人资料时传 showAvatar: false，
 * 因为头像接口只作用于当前登录账号。头像写入是立即保存的，与底部「保存」无关。
 */
import { computed } from 'vue';
import ProfileAvatarField from '@/components/ProfileAvatarField.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

interface Props {
  mode: 'profile';
  form: Record<string, string>;
  invalid: Record<string, boolean>;
  error: string | (() => string);
  limits: Record<string, number>;
  /** 是否渲染头像块；缺省渲染，管理员代改别人资料时传 false。 */
  showAvatar?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  update: [field: string, value: string];
  submit: [];
  avatarUpdated: [fresh: JsonObject];
}>();

const errorMessage = computed(() => (typeof props.error === 'function' ? props.error() : props.error));

function update(field: string, event: Event): void {
  emit('update', field, (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="emit('submit')">
    <template v-if="mode === 'profile'">
      <!-- 头像在昵称之前：先看到自己现在长什么样，再改文字资料 -->
      <ProfileAvatarField v-if="props.showAvatar !== false" @updated="emit('avatarUpdated', $event)" />
      <div class="field" :data-invalid="invalid.nickname ? 'true' : 'false'">
        <label for="settings-nickname">{{ t('settings.profile.nickname') }}</label>
        <input
          id="settings-nickname"
          class="input"
          type="text"
          autocomplete="nickname"
          :value="form.nickname"
          :maxlength="limits.nickname"
          @input="update('nickname', $event)"
        />
      </div>
      <div class="field" :data-invalid="invalid.bio ? 'true' : 'false'">
        <label for="settings-bio">{{ t('profile.bio') }}</label>
        <textarea
          id="settings-bio"
          class="textarea"
          rows="3"
          :value="form.bio"
          :maxlength="limits.bio"
          @input="update('bio', $event)"
        />
      </div>
      <div class="field" :data-invalid="invalid.region ? 'true' : 'false'">
        <label for="settings-region">{{ t('settings.profile.region') }}</label>
        <input
          id="settings-region"
          class="input"
          type="text"
          autocomplete="address-level1"
          :value="form.region"
          :maxlength="limits.region"
          :placeholder="t('settings.profile.regionPlaceholder')"
          @input="update('region', $event)"
        />
      </div>
      <div class="field" :data-invalid="invalid.socialMedia ? 'true' : 'false'">
        <label for="settings-social">{{ t('settings.profile.social') }}</label>
        <input
          id="settings-social"
          class="input"
          type="text"
          :value="form.socialMedia"
          :maxlength="limits.socialMedia"
          @input="update('socialMedia', $event)"
        />
      </div>
    </template>

    <p v-if="errorMessage" class="field-error" role="alert">{{ errorMessage }}</p>
  </form>
</template>
