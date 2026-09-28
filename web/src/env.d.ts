/// <reference types="vite/client" />

/**
 * 全局类型声明：这里只声明「运行时由外部注入、TS 看不见」的东西，没有可执行代码。
 *
 * 为什么需要：`window.CalMobileStrings` 由原生 `InjectStrings` 注入，
 * 全局 `jsQR` 由 `services/vendor.ts` 在核销页按需插入 `<script>` 带来，
 * 两者都不在模块图里，必须手工声明，否则页面里引用它们会被判成未定义。
 *
 * 坑：两处都声明成**可选**，因为浏览器预览、单测、以及还没加载 vendor 的那一屏都没有它们；
 * 读取时要自己判空（`?.`、`typeof x === 'function'`），别用非空断言。
 */
declare global {
  /** 原生注入的前端文案表：key（`s_xxx`）→ 文案；浏览器里是 undefined，见 `i18n/index.ts`。 */
  interface Window {
    CalMobileStrings?: Record<string, string>;
  }
  /**
   * 二维码识别库（`web/public/vendor/jsQR.js`）暴露的全局函数。
   * 声明的是**类型**，运行时对象由按需注入的脚本挂到全局（浏览器里等价于 `window.jsQR`）。
   * @param data RGBA 像素数据（长度 = width × height × 4）
   * @param width 图像宽度
   * @param height 图像高度
   * @returns 识别到二维码时给出 `data` 文本，否则为 null；未注入时整个函数是 undefined
   */
  const jsQR: ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null) | undefined;
}

// 文件里有 import / export 才算模块，模块里的 `declare global` 才生效；无运行时代码。
export {};
