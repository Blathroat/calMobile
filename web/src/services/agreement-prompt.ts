/**
 * 已登录用户的「用户协议更新」确认。
 *
 * 判定只有一条：**当前登录用户已同意的版本低于服务端当前版本**（`bootstrap.agreement` 的小摘要
 * 对 `user.agreedTermsVersion`）。协议关闭、没有版本、或从未登录都不弹。
 *
 * 抽屉不可关闭（`dismissible: false`）：必须从「查看用户协议 / 不同意并退出 / 同意」里选一条路。
 * 打开时机与「不要重复叠弹窗」由外壳负责（见 `app/App.vue` 的 watch）：
 * - 协议页本身不叠弹窗，从协议页返回其它页面后仍未同意会重新弹；
 * - 抽屉已经在屏幕上时（`sheet.current`）不再开第二个。
 *
 * 同意成功只做两件事：写 `POST /profile/agreement`，再重拉一份启动数据 —— 条件由
 * `user.agreedTermsVersion` 驱动，刷新后 `App.vue` 的判定自然消失，这里不去改本地会话。
 * 失败时 toast 并保持抽屉打开，让用户还能重试或去看协议。
 */
import { api, refreshRuntimeBootstrap } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { device } from '@/services/device-services';
import { openSheet, sheet } from '@/services/sheet';
import { toast } from '@/services/toast';
import { formatLocalChineseDate } from '@/services/format';
import { t } from '@/i18n';

/** 当前生效的协议版本；协议关闭或版本非法时是 0（0 表示没有需要同意的版本）。 */
export function agreementCurrentVersion(): number {
  const agreement = useBootstrapStore().agreement;
  if (agreement?.enabled !== true) return 0;
  return Number(agreement.version ?? 0) || 0;
}

/** 已登录、协议开启、且当前版本高于用户已同意的版本时才需要确认。 */
export function agreementConsentPending(): boolean {
  const session = useSessionStore();
  if (!session.loggedIn) return false;
  const version = agreementCurrentVersion();
  if (version <= 0) return false;
  return version > (Number(session.user.agreedTermsVersion ?? 0) || 0);
}

/**
 * 打开不可关闭的更新确认抽屉。
 * @param options.onView 用户点「查看用户协议」时调用（由外壳负责 `router.push('/agreement')`）；
 *   抽屉会先收起来，避免与协议页叠在一起。
 */
export function openAgreementConsentPrompt(options: { onView: () => void }): void {
  if (sheet.current) return;
  const version = agreementCurrentVersion();
  if (version <= 0) return;
  const updatedAt = String(useBootstrapStore().agreement?.updatedAt ?? '');
  // 日期能解析就用中文日期，解析不出就原样展示，不吞掉服务端给的值。
  const date = formatLocalChineseDate(updatedAt) || updatedAt;
  openSheet({
    title: t('agreement.prompt.title'),
    message: date ? t('agreement.prompt.message', { version, date }) : t('agreement.prompt.messageNoDate', { version }),
    layout: 'stack',
    dismissible: false,
    actions: [
      {
        label: t('agreement.prompt.view'),
        variant: 'ghost',
        onClick: (close) => {
          close();
          options.onView();
        },
      },
      {
        label: t('agreement.prompt.disagree'),
        variant: 'danger',
        onClick: async () => {
          try {
            const result = await device.exitApp();
            // 浏览器里 window.close() 通常被拒绝：不假装已经退出，告诉用户怎么走。
            if (!result?.closed) toast(t('agreement.prompt.exitUnavailable'), 'error');
          } catch (reason) {
            toast(
              reason instanceof Error && reason.message ? reason.message : t('agreement.prompt.exitUnavailable'),
              'error',
            );
          }
        },
      },
      {
        label: t('agreement.prompt.agree'),
        variant: 'primary',
        onClick: async (close) => {
          try {
            await api.profile.agree(version);
            // 写入后重拉启动数据：`user.agreedTermsVersion` 更新，弹窗条件随之消失。
            await refreshRuntimeBootstrap();
            close();
          } catch (reason) {
            toast(
              reason instanceof Error && reason.message ? reason.message : t('agreement.prompt.agreeFailed'),
              'error',
            );
          }
        },
      },
    ],
  });
}
