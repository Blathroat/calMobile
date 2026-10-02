/** 二维码生成库仅在实际绘制报名码或验证器二维码时加载。 */
export async function drawQr(node: HTMLCanvasElement, text: string, quiet = 4): Promise<boolean> {
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
  // 相机识别要求白底深色，不跟随页面主题反色。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, node.width, node.height);
  context.fillStyle = '#20252b';
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (!model.isDark(row, column)) continue;
      context.fillRect(
        Math.round((column + quiet) * scale), Math.round((row + quiet) * scale),
        Math.ceil(scale), Math.ceil(scale),
      );
    }
  }
  return true;
}
