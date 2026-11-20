<script setup lang="ts">
/**
 * 用户设置里的资料表单内容；抽屉标题和保存 / 取消动作由全局 AppSheet 负责。
 *
 * 头像块放在抽屉最上方，本人与管理员代改都渲染：本人用会话里的头像，管理员代改时由
 * `services/profile-editor.ts` 传入目标用户的 `avatar` / `nickname`，上传也走目标账号。
 * 头像块里只剩一颗铅笔，点它只发 `editAvatar`：「先保存资料、退出资料抽屉，再打头像编辑抽屉」
 * 由 `services/profile-editor.ts` 负责。
 */
import { computed } from 'vue';
import ProfileAvatarField from '@/components/ProfileAvatarField.vue';
import { t } from '@/i18n';

interface Props {
  mode: 'profile';
  form: Record<string, string>;
  invalid: Record<string, boolean>;
  error: string | (() => string);
  limits: Record<string, number>;
  /** 是否渲染头像块；缺省渲染。 */
  showAvatar?: boolean;
  /** 头像预览地址；缺省取当前登录账号。管理员代改时传目标用户。 */
  avatar?: string;
  /** 头像预览昵称；缺省取当前登录账号。管理员代改时传目标用户。 */
  nickname?: string;
  /** 头像块是否受限；缺省按当前登录账号判断。管理员代改时传 false。 */
  limited?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  update: [field: string, value: string];
  submit: [];
  /** 用户点了头像块里的铅笔：调用方先保存资料，再打头像编辑抽屉。 */
  editAvatar: [];
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
      <ProfileAvatarField
        v-if="props.showAvatar !== false"
        :avatar="props.avatar"
        :nickname="props.nickname"
        :limited="props.limited"
        @edit="emit('editAvatar')"
      />
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
