/**
 * 未自带类型、也还没有 `@types/*` 的 CommonJS 依赖的最小声明。
 *
 * 只声明本仓库真正用到的那几个签名，不做 `any` 兜底 —— 这两个包各有去处：
 * `jsonwebtoken` 会被 `jose` 取代，`nodemailer` 是刻意留用的零依赖 SMTP 客户端
 * （见 ADR 0001「留用与删除」）。两者都换掉之后，这个文件随之删除。
 *
 * 之所以必须写在这里：ESM 下没有 `require()`，而 `noImplicitAny` 会让
 * 「导入一个没有声明的模块」直接成为编译错误，不能像 CJS 时代那样运行时才炸。
 */

declare module 'jsonwebtoken' {
  interface SignOptions {
    expiresIn?: string | number;
    [option: string]: unknown;
  }

  function sign(payload: object, secretOrPrivateKey: string, options?: SignOptions): string;
  /**
   * 只返回解出来的载荷；验签失败时抛错，由调用方翻成 401。
   * 具体形状由泛型参数给出 —— jsonwebtoken 自己不保证载荷里有什么。
   */
  function verify<T = unknown>(token: string, secretOrPublicKey: string): T;

  const jsonwebtoken: {
    sign: typeof sign;
    verify: typeof verify;
  };

  export default jsonwebtoken;
}

declare module 'nodemailer' {
  /**
   * 连接池相关的选项本仓库用不上，统一当未知对象收下；
   * 返回值的形状由调用方按自己声明的最小接口收窄（见 `services/mailer.ts` 的 `SmtpTransport`）。
   */
  function createTransport(options: unknown): unknown;

  const nodemailer: {
    createTransport: typeof createTransport;
  };

  export default nodemailer;
}
