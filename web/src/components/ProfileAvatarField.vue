<script setup lang="ts">
/**
 * 资料抽屉最上方的头像块：居中大预览 + 右下角铅笔。
 *
 * 头像的选图、裁剪与上传都在关掉资料抽屉之后走：点这里先保存资料、退出抽屉，再由
 * `services/profile-editor.ts` 直接拉起系统选图，选定图片后弹出裁剪抽屉
 * （`components/ProfileAvatarCropper.vue`）。这里只留一个编辑入口——
 * 铅笔是唯一可见的动作，点头像本身也算点它；点下去只发 `edit`，
 * 「先保存资料并退出资料抽屉，再打头像抽屉」由 `services/profile-editor.ts` 负责。
 *
 * 预览与受限状态默认取当前登录账号；管理员代改别人资料时由调用方传入目标用户的
 * `avatar` / `nickname` 并显式给 `limited: false`（管理员不受目标账号状态限制），
 * 预览里不能出现管理员自己的头像。
 *
 * 当前没有移除头像的入口：头像只换不删。受限账号（后端明确下发 `can.profile === false`）
 * 禁用入口并原位说明原因；后端也会拒绝。
 */
import { computed } from 'vue';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import AvatarBox from '@/components/AvatarBox.vue';
import AppIcon from '@/components/AppIcon.vue';
import { t } from '@/i18n';

const props = defineProps<{
  /** 预览头像地址；缺省取当前登录账号。 */
  avatar?: string;
  /** 预览昵称（无头像时生成首字占位）；缺省取当前登录账号。 */
  nickname?: string;
  /** 是否受限；缺省按当前登录账号的 `can.profile` 判断。管理员代改时传 false。 */
  limited?: boolean;
}>();

const emit = defineEmits<{
  /** 用户点了头像或铅笔：资料抽屉据此先保存资料，再打头像编辑抽屉。 */
  edit: [];
}>();

const session = useSessionStore();
const avatarSrc = computed(() => String(props.avatar ?? session.user.avatar ?? ''));
const displayName = computed(() => String(props.nickname ?? session.user.nickname ?? session.user.username ?? ''));
/** 受限账号：显式传入时以调用方为准，否则只有后端明确下发 `false` 才算，老后端不下发时行为不变。 */
const limited = computed(() => props.limited ?? session.user.can?.profile === false);

/** 唯一的编辑入口：受限账号只说明原因，其余交给资料抽屉。 */
function requestEdit(): void {
  if (limited.value) {
    toast(t('profile.restricted'), 'error');
    return;
  }
  emit('edit');
}
</script>

<template>
  <div class="field avatar-field" data-avatar-field="true">
    <!-- 整个头像都是按钮：点铅笔或点头像都算编辑，命中区远大于 44px。 -->
    <button
      class="avatar-field-trigger"
      type="button"
      data-avatar-edit="true"
      :disabled="limited"
      :aria-label="t('settings.profile.editAvatar')"
      :title="limited ? t('profile.restricted') : t('settings.profile.editAvatar')"
      @click="requestEdit"
    >
      <AvatarBox :src="avatarSrc" :name="displayName" />
      <!-- 铅笔小圆只是视觉提示：可见圆 30px，外层 44px 命中区与按钮重合。 -->
      <span class="avatar-field-pencil" aria-hidden="true">
        <span class="avatar-field-pencil-dot"><AppIcon name="edit" /></span>
      </span>
    </button>
    <!-- 受限：说明为什么编辑入口不可用（后端也会拒绝写入） -->
    <p v-if="limited" class="field-hint">{{ t('profile.restricted') }}</p>
  </div>
</template>

<style>
/* 头像块：没有标题、大按钮与说明，只把预览居中放大。 */
.avatar-field {
  justify-items: center;
}

.avatar-field > .field-hint {
  text-align: center;
}

/* 头像本身是一颗按钮：点击头像或铅笔都算编辑。 */
.avatar-field-trigger {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: var(--r-pill);
}

/* 预览放大到 88px：AvatarBox 自带的 44px 在这里只当尺寸基线。 */
.avatar-field-trigger .avatar {
  width: 88px;
  height: 88px;
  font-size: 32px;
}

.avatar-field-trigger:disabled {
  cursor: not-allowed;
}

/* 铅笔：44px 命中区里放一颗 30px 的圆，主题色底 + 白图标，压在头像右下角。 */
.avatar-field-pencil {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.avatar-field-pencil-dot {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 2px solid var(--screen);
  border-radius: var(--r-pill);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-float);
}

.avatar-field-pencil-dot svg {
  width: 15px;
  height: 15px;
}
</style>
