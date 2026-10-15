<script setup lang="ts">
/**
 * 私人会议相关设置。
 *
 * 页顶是可复制的申请地址和一行说明。开关控制是否接受新的预约。
 * 收集项卡片与编辑展会的报名收集项是同一个组件。
 * 受限或封禁的账号开关强制关闭，也不能保存。
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '@/app/runtime';
import { useAsync } from '@/composables/useAsync';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { toast } from '@/services/toast';
import { openSheet } from '@/services/sheet';
import { meetingLink } from '@/services/registration-link';
import { limit } from '@/services/validate';
import { firstCollectFieldError } from '@/services/collect-fields';
import AppIcon from '@/components/AppIcon.vue';
import CollectFieldsCard, { type CollectField } from '@/components/CollectFieldsCard.vue';
import StateBlock from '@/components/StateBlock.vue';
import SkeletonBlock from '@/components/SkeletonBlock.vue';
import type { JsonObject } from '@/api/types';
import { t } from '@/i18n';

const session = useSessionStore();
const bootstrap = useBootstrapStore();
const query = useAsync<JsonObject>();
const link = computed(() => meetingLink(bootstrap.publicBaseUrl, session.user.id));
const accept = ref(false);
const allowCancel = ref(false);
const notice = ref('');
const fields = ref<CollectField[]>([]);
const forcedOff = ref(false);
const saving = ref(false);
const built = ref(false);

const locked = computed(() => forcedOff.value || session.user.can?.limited === true);
const ready = computed(() => built.value);

const COPY = {
  acceptLabel: t('meeting.settings.accept'),
  acceptHint: t('meeting.settings.acceptHint'),
  allowCancelLabel: t('meeting.settings.allowCancel'),
  allowCancelHint: t('meeting.settings.allowCancelHint'),
  noticeLabel: t('meeting.settings.notice'),
  noticeHint: t('meeting.settings.noticeHint'),
  forcedHint: t('meeting.settings.restrictedAccount'),
  fieldsLabel: t('meeting.settings.collectFields'),
  fieldsHint: t('meeting.settings.collectFieldsHint'),
  save: t('meeting.settings.save'),
  copy: t('meeting.copyLink'),
  missing: t('exhibition.detail.registrationSiteMissing'),
  copied: t('meeting.linkCopied'),
  shareHint: t('meeting.settings.shareHint'),
};

async function copyLink(): Promise<void> {
  if (!link.value) {
    toast(COPY.missing, 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(link.value);
    toast(COPY.copied);
  } catch {
    openSheet({
      title: COPY.copy,
      message: link.value,
      actions: [{ label: t('common.cancel'), onClick: (close) => close() }],
    });
  }
}

function apply(data: JsonObject): void {
  if (built.value) return;
  forcedOff.value = data.forcedOff === true;
  accept.value = forcedOff.value ? false : data.acceptMeetings === true;
  allowCancel.value = data.allowCancel === true;
  notice.value = String(data.notice || '');
  fields.value = (Array.isArray(data.fields) ? data.fields : []).map((field) => {
    const item = field as JsonObject;
    return {
      title: String(item.title || ''),
      type: String(item.type || '文本'),
      required: item.required === true,
      options: Array.isArray(item.options) ? item.options.map((option) => String(option)) : [],
    };
  });
  built.value = true;
}

function load(): void {
  void query.run(async () => {
    const data = await api.meetings.settings();
    apply(data);
    return data;
  });
}

onMounted(load);

async function save(): Promise<void> {
  if (locked.value || saving.value) {
    if (locked.value) toast(COPY.forcedHint, 'error');
    return;
  }
  const fieldMessage = firstCollectFieldError(fields.value, {
    title: limit('fieldTitle', 30),
    radio: limit('radioOption', 60),
    check: limit('checkOption', 60),
  });
  if (fieldMessage) {
    toast(fieldMessage, 'error');
    return;
  }
  saving.value = true;
  try {
    const result = await api.meetings.saveSettings({
      acceptMeetings: accept.value,
      allowCancel: allowCancel.value,
      notice: notice.value.trim(),
      fields: fields.value
        .filter((item) => item.title.trim() !== '')
        .map((item) => ({
          title: item.title.trim(),
          type: item.type,
          required: item.required,
          options: item.type === '文本' ? [] : item.options.map((option) => option.trim()).filter(Boolean),
        })),
    });
    if (result?.ok === false) {
      toast(String(result.error || t('exhibition.form.saveFailed')), 'error');
      return;
    }
    toast(t('meeting.settings.saved'), 'success');
  } catch (reason) {
    toast(reason instanceof Error ? reason.message : String(reason), 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card">
    <div class="copy-line">
      <span class="row-meta truncate">{{ link || COPY.missing }}</span>
      <button class="icon-hit" type="button" :aria-label="COPY.copy" @click="copyLink">
        <AppIcon name="copy" size="icon icon-sm" />
      </button>
    </div>
    <p class="field-hint" data-one-line="true">{{ COPY.shareHint }}</p>
  </div>
  <SkeletonBlock v-if="query.loading.value && !ready" :rows="3" />
  <StateBlock
    v-else-if="query.error.value && !ready"
    tone="error"
    :title="t('common.loadFailed')"
    :description="query.error.value.message"
    :action-label="t('common.retry')"
    @action="load"
  />
  <template v-else-if="ready">
    <div v-if="locked" class="notice" data-tone="accent">
      <span>{{ COPY.forcedHint }}</span>
    </div>
    <div class="card">
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ COPY.acceptLabel }}</strong>
          <span class="row-meta">{{ locked ? COPY.forcedHint : COPY.acceptHint }}</span>
        </span>
        <label class="switch" for="meeting-accept">
          <input id="meeting-accept" v-model="accept" type="checkbox" :disabled="locked" />
          <span />
        </label>
      </div>
      <hr class="divider" />
      <div class="switch-row">
        <span class="switch-copy">
          <strong>{{ COPY.allowCancelLabel }}</strong>
          <span class="row-meta">{{ COPY.allowCancelHint }}</span>
        </span>
        <label class="switch" for="meeting-allow-cancel">
          <input id="meeting-allow-cancel" v-model="allowCancel" type="checkbox" :disabled="locked" />
          <span />
        </label>
      </div>
    </div>
    <div class="field">
      <label for="meeting-notice">{{ COPY.noticeLabel }}</label>
      <textarea
        id="meeting-notice"
        v-model="notice"
        class="textarea"
        maxlength="400"
        :disabled="locked"
      />
      <p class="field-hint">{{ COPY.noticeHint }}</p>
    </div>
    <CollectFieldsCard
      :fields="fields"
      :label="COPY.fieldsLabel"
      :hint="COPY.fieldsHint"
      :title-max="limit('fieldTitle', 30)"
      :radio-max="limit('radioOption', 60)"
      :check-max="limit('checkOption', 60)"
      :disabled="locked"
    />
  </template>

  <Teleport v-if="ready" defer to="#app-foot">
    <div class="page-foot">
      <button
        class="cta"
        type="button"
        :disabled="locked || saving"
        :data-loading="saving ? 'true' : 'false'"
        @click="save"
      >
        {{ COPY.save }}
      </button>
    </div>
  </Teleport>
</template>
