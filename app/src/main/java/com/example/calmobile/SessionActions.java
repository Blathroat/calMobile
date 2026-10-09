package com.example.calmobile;

import android.app.Activity;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 会话与稳定设备凭据：`session.save` / `session.load` / `session.clear` / `session.device`。
 *
 * 刷新令牌是**设备状态**而非业务数据，因此它的落地在原生侧（{@link SessionStore}），
 * 前端通过桥接读写；访问令牌仍然只在内存里，冷启动时用刷新令牌换新的。
 * 三个动作都不需要权限、也不开系统界面，同步完成即可回调。
 *
 * **空令牌不是失败**：`session.save` 收到空令牌等价于 `session.clear`，
 * `session.load` 没有会话时回空串而不是失败——前端拿这个结果决定「去登录页还是留在首页」，
 * 用失败表达只会让它把「本来就没登录」当成网络或原生故障来提示。
 */
final class SessionActions {

    private SessionActions() {
    }

    /**
     * `session.save`：payload `{ refreshToken: string, username?: string }`，
     * 成功回调 `{ ok: true, refreshToken: string, username: string }`
     * （回包带上归一化后的结果，前端可直接更新内存态，不必再 `session.load` 一次）。
     */
    static Map<String, Object> save(Activity activity, Map<String, Object> payload) {
        String token = WebAppBridge.text(payload, "refreshToken", "");
        String name = WebAppBridge.text(payload, "username", "");
        SessionStore.State state = SessionStore.save(activity, token, name);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        // 空令牌走的是清除分支，这里如实地把「已清空」告诉前端，
        // 而不是回一个它刚发过来的空令牌。
        result.put("refreshToken", state.refreshToken);
        result.put("username", state.username);
        return result;
    }

    /**
     * `session.load`：无 payload，成功回调 `{ refreshToken: string, username: string }`；
     * 没有会话时两个字段都是空串。
     */
    static Map<String, Object> load(Activity activity) {
        SessionStore.State state = SessionStore.load(activity);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("refreshToken", state.refreshToken);
        result.put("username", state.username);
        return result;
    }

    /** `session.clear`：无 payload，成功回调 `{ ok: true }`。 */
    static Map<String, Object> clear(Activity activity) {
        SessionStore.clear(activity);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        return result;
    }

    /** `session.device`：读取或首次创建仅供本机使用的随机设备凭据。 */
    static Map<String, Object> device(Activity activity) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deviceToken", SessionStore.deviceToken(activity));
        return result;
    }
}
