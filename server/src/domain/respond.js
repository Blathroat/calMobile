/**
 * 写操作的统一收尾。
 *
 * 约定（前后端都按这个来，见 server/README.md「响应约定」）：
 *
 * - **校验与业务规则失败**（400 / 409：参数不合法、状态不允许、重复报名…）
 *   → HTTP 200 + `{ ok:false, error }`。页面用 `if (!result.ok)` 就地提示，
 *   这条路径与原生桥接完全一致，因此换后端页面不用改；
 * - **认证 / 授权 / 找不到目标**（401 / 403 / 404）→ 原样抛出，交给 index.js 的错误
 *   中间件给出对应状态码 + `{ error }`。前端 api.js 会当作异常抛出，由页面的
 *   catch 展示；也避免把「无权访问」伪装成 200 成功。
 */

const { ApiError } = require('./errors');

/** 会被转成应用层信封的状态码。 */
const ENVELOPE_STATUS = new Set([400, 409]);

/** 包住一段写操作：成功补上 ok/error，业务失败转成信封。 */
async function mutate(res, next, run) {
  try {
    const payload = await run();
    res.json({ ok: true, error: '', ...(payload || {}) });
  } catch (error) {
    if (error instanceof ApiError && ENVELOPE_STATUS.has(error.status)) {
      res.json({ ok: false, error: error.message });
      return;
    }
    next(error);
  }
}

module.exports = { mutate, ENVELOPE_STATUS };
