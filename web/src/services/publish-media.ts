/**
 * 把设备上刚选中的图片或视频上传到服务器，并删掉设备上的临时文件。
 *
 * 上传失败也删临时文件，否则选择器落盘的副本会留在设备里，页面又用不到。
 */
import { api } from '@/app/runtime';
import { t } from '@/i18n';
import { device } from '@/services/device-services';

export async function publishImportedMedia(
  kind: 'image' | 'video',
  imported: { url?: string; fileName?: string },
): Promise<string> {
  const localUrl = String(imported.url || '');
  const fileName = String(imported.fileName || '');
  const discard = () => {
    if (!fileName) return;
    void device.discardMedia(fileName).catch(() => undefined);
  };
  try {
    if (!localUrl) throw new Error(kind === 'video' ? t('s_1xdkilh') : t('s_fhsoqj'));
    const response = await fetch(localUrl);
    if (!response.ok) throw new Error(t('s_1mkhjfu'));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = response.headers.get('content-type') || '';
    const contentType = header.split(';')[0]?.trim() || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
    const saved = await api.media.upload(bytes, contentType, kind);
    const url = String(saved.url || '');
    if (!url) throw new Error(t('s_10m3pm3'));
    discard();
    return url;
  } catch (error) {
    discard();
    throw error;
  }
}
