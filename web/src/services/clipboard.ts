/**
 * 复制一段文本到系统剪贴板。
 *
 * 先走异步 Clipboard API（现代 WebView 与安全上下文支持，且不弹系统菜单）；
 * 不可用或被拒绝时退回隐藏 textarea + `document.execCommand('copy')` ——
 * Android WebView 里这条老路仍然可用，不用再给用户弹一个「手动复制」面板。
 *
 * 返回是否成功：调用方据此提示成功或失败。复制本身是附加动作，
 * 失败不该抛异常把主流程带崩，因此这里只回布尔值。
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 非安全上下文、权限被拒、没有用户手势：都留给下面的兜底再试一次。
  }
  return legacyCopy(value);
}

/**
 * 降级复制：把文本放进屏幕外的只读 textarea，选中后用 `execCommand('copy')`。
 *
 * 选区在结束后恢复，用户正在编辑的输入框不会因为点了复制而丢光标。
 * 不插 `hidden` 属性：部分内核里 `display:none` 的元素无法被选中，改用定位移出视口。
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);

  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    area.select();
    // select() 在部分 WebView 里只聚焦不选中，显式定一次范围。
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
}
