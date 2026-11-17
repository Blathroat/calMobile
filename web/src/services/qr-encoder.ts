/** 二维码生成库仅在实际绘制报名码、验证器二维码或展商分享二维码时加载。 */

/** 绘制选项：默认沿用「白底深色点」的报名码样式。 */
export interface QrDrawOptions {
  /**
   * 底色。默认 `'white'`（铺白，报名码与验证器都要求白底）；
   * `'transparent'` 不铺任何底色，导出 PNG 保留透明背景（点由前景色决定）。
   */
  background?: 'white' | 'transparent';
  /** 点的颜色，默认沿用页面主题的深石墨色；透明导出传 `'#000000'` 提高对比。 */
  foreground?: string;
}

/**
 * 把文本画进画布：成功返回 true，内容画不出来（超长等）或画布不可用时返回 false。
 *
 * 相机识别要求深色点配浅色底，因此不跟随页面主题反色。是否铺白底由 `options.background`
 * 决定：报名码固定白底；展商后台要保存「透明背景 PNG」时传 `'transparent'`。
 */
export async function drawQr(
  node: HTMLCanvasElement,
  text: string,
  quiet = 4,
  options: QrDrawOptions = {},
): Promise<boolean> {
  const { default: qrcode } = await import('qrcode-generator');
  const model = qrcode(0, 'M');
  try {
    model.addData(text);
    model.make();
  } catch {
    return false;
  }
  const context = node.getContext('2d');
  if (!context) return false;
  const modules = model.getModuleCount();
  const scale = node.width / (modules + quiet * 2);
  if (options.background === 'transparent') {
    // 透明导出：先清空画布（同一张画布上可能画过白底版本），再只画点，PNG 的 alpha 通道才保留。
    context.clearRect(0, 0, node.width, node.height);
  } else {
    // 默认沿用报名码的白底深点。
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, node.width, node.height);
  }
  context.fillStyle = options.foreground ?? '#20252b';
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!model.isDark(row, column)) continue;
      context.fillRect(
        Math.round((column + quiet) * scale),
        Math.round((row + quiet) * scale),
        Math.ceil(scale),
        Math.ceil(scale),
      );
    }
  }
  return true;
}
