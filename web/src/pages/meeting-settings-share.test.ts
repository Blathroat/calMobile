/**
 * 私人会议设置页顶的分享二维码：链接行右侧的二维码按钮复用展商后台的分享抽屉，
 * 二维码内容必须是 `/m/<用户 id>` 链接、标题是用户昵称；没配报名站地址时只提示，
 * 不打开空二维码。
 *
 * 这里 mock 掉底部面板：只锁点按钮时传进面板的内容，抽屉本身由 ShareQrSheet 负责。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import MeetingSettingsPage from './MeetingSettingsPage.vue';
import ShareQrSheet from '@/components/ShareQrSheet.vue';
import { api } from '@/app/runtime';
import { useBootstrapStore } from '@/stores/bootstrap';
import { useSessionStore } from '@/stores/session';
import { openSheet } from '@/services/sheet';
import { toast } from '@/services/toast';

vi.mock('@/app/runtime', () => ({
  api: { meetings: { settings: vi.fn(), saveSettings: vi.fn() } },
}));
vi.mock('@/services/device-services', () => ({ device: { saveImage: vi.fn() } }));
vi.mock('@/services/sheet', () => ({ openSheet: vi.fn() }));
vi.mock('@/services/toast', () => ({ toast: vi.fn() }));

const BASE = 'https://expo.example.com';
const USER_ID = 'usr-2';
const LINK = `${BASE}/m/${USER_ID}`;
const FILE_NAME = `meeting-qr-${USER_ID}.png`;
const SETTINGS = { forcedOff: false, acceptMeetings: true, allowCancel: true, notice: '', fields: [] };

let app: App | undefined;

beforeEach(() => {
  document.body.innerHTML = '<div id="app-foot"></div><div id="meeting-settings-test"></div>';
  vi.clearAllMocks();
  vi.mocked(api.meetings.settings).mockResolvedValue(SETTINGS);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

async function mountPage(publicBaseUrl = BASE): Promise<void> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().applyUser({ id: USER_ID, nickname: '林小满', role: 'exhibitor', can: {} });
  useBootstrapStore().publicBaseUrl = publicBaseUrl;
  app = createApp(MeetingSettingsPage).use(pinia);
  app.mount('#meeting-settings-test');
  await vi.waitFor(() => expect(document.querySelector('.copy-line')).not.toBeNull());
  await vi.waitFor(() => expect(document.querySelector('#meeting-accept')).not.toBeNull());
}

function qrButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('.copy-line button[aria-label="分享预约二维码"]')!;
}

describe('私人会议设置的分享二维码', () => {
  it('链接行右侧是二维码图标按钮，复制按钮仍在', async () => {
    await mountPage();
    const button = qrButton();
    expect(button).not.toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('.copy-line button[aria-label="复制"]')).not.toBeNull();
  });

  it('点按钮打开与展商后台同一个抽屉：二维码指向 /m/<用户 id>，标题是昵称', async () => {
    await mountPage();
    qrButton().click();
    await nextTick();

    expect(openSheet).toHaveBeenCalledOnce();
    const options = vi.mocked(openSheet).mock.calls[0]![0];
    expect(options.title).toBe('分享预约');
    expect(options.component).toBe(ShareQrSheet);
    expect(options.props).toEqual({
      text: LINK,
      title: '林小满',
      fileName: FILE_NAME,
      qrLabel: '私人会议预约二维码',
      hint: '扫码打开预约页，保存图片后可转发给他人',
      savedText: '预约二维码已保存',
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('没配报名站地址时只提示，不打开空二维码', async () => {
    await mountPage('');
    qrButton().click();
    await nextTick();

    expect(openSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('报名站地址未配置', 'error');
  });
});
