/**
 * 把设备上刚选中的图片或视频上传到服务器，并释放设备侧临时数据。
 *
 * 原生通道里选择器会落盘一份副本，上传失败也要删掉，否则副本会留在设备里；
 * 浏览器通道里 `importMedia` 给的是 `blob:` object URL，上传结束或失败都要
 * `URL.revokeObjectURL`，否则整段媒体会一直被页面引用着占内存。原生 URL 不碰。
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
  const release = () => {
    // 只有浏览器给的 object URL 需要收回；原生文件地址（file:// 等）不动。
    if (localUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(localUrl);
      } catch {
        // 内核不支持 / 已经回收过：不影响上传结果。
      }
    }
    if (!fileName) return;
    void device.discardMedia(fileName).catch(() => undefined);
  };
  try {
    if (!localUrl) throw new Error(kind === 'video' ? t('media.missingVideo') : t('media.missingImage'));
    const response = await fetch(localUrl);
    if (!response.ok) throw new Error(t('media.unreadableFile'));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const header = response.headers.get('content-type') || '';
    const contentType = header.split(';')[0]?.trim() || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
    const saved = await api.media.upload(bytes, contentType, kind);
    const url = String(saved.url || '');
    if (!url) throw new Error(t('media.missingUploadUrl'));
    release();
    return url;
  } catch (error) {
    release();
    throw error;
  }
}
