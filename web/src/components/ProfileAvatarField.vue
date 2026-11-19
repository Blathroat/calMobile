<script setup lang="ts">
/**
 * 资料抽屉最上方的头像块：居中大预览 + 右下角铅笔。
 *
 * 头像的选图、裁剪、上传与移除都搬进了独立的头像编辑抽屉（`ProfileAvatarSheet.vue`）：
 * 那里放得下裁剪框，也不会和资料抽屉里的文字保存混在一起。这里只留一个编辑入口——
 * 铅笔是唯一可见的动作，点头像本身也算点它；点下去只发 `edit`，
 * 「先保存资料并退出资料抽屉，再打头像抽屉」由 `services/profile-editor.ts` 负责。
 *
 * 受限账号（后端明确下发 `can.profile === false`）禁用入口并原位说明原因；后端也会拒绝。
 * 管理员代改别人资料时整个块不渲染（头像接口只作用于当前登录账号），由调用方控制。
 */
import { computed } from 'vue';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import AvatarBox from '@/components/AvatarBox.vue';
import AppIcon from '@/components/AppIcon.vue';
import { t } from '@/i18n';

const emit = defineEmits<{
  /** 用户点了头像或铅笔：资料抽屉据此先保存资料，再打头像编辑抽屉。 */
  edit: [];
}>();

const session = useSessionStore();
const user = computed(() => session.user);
/** 受限账号：只有后端明确下发 `false` 才算，老后端不下发时行为不变。 */
const limited = computed(() => user.value.can?.profile === false);

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
      <AvatarBox :src="String(user.avatar || '')" :name="String(user.nickname || user.username || '')" />
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
  color: var(--on-dark);
  box-shadow: var(--shadow-float);
}

.avatar-field-pencil-dot svg {
  width: 15px;
  height: 15px;
}
</style>
