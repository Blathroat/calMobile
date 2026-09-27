package com.example.calmobile;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 登录会话的**设备状态**存储：刷新令牌与上次登录的用户名。
 *
 * 为什么单独一个文件（`calmobile.session`）而不塞进 {@link AppSettings}：
 *
 * - {@code AppSettings} 是「后端设置的设备镜像」，值的权威来源是服务器，前端用 `ui.sync`
 *   把它推下来，清掉也无所谓（下一次同步就回来了）；
 * - 这里的刷新令牌是**设备自己的状态**，权威来源就是这台设备：后端不认识它，
 *   也不能被 `ui.sync` 之类「重放设置」的动作覆盖掉。
 * 两者生命周期完全不同（一个跟着服务器走、一个跟着登录走），混在一个文件里
 * 迟早会出现「同步设置顺手把会话清了」或「清会话顺手把配色重置了」的串味问题，
 * 因此各存各的文件，各有一个 clear 入口。
 *
 * 写文件用的是应用私有目录（{@code Context.MODE_PRIVATE}），不导出、不进备份目录，
 * 卸载即随之消失；访问令牌按设计只留在内存里（见前端 `session-client.ts`），
 * 冷启动时用这里的刷新令牌换回新的访问令牌。
 */
public final class SessionStore {

    /** 独立于 `app_settings` 的私有文件：会话只属于本设备，语义与设置镜像不同。 */
    private static final String PREFS = "calmobile.session";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";
    private static final String KEY_USERNAME = "username";

    private SessionStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── 纯逻辑（不碰 Android API，可在普通 JVM 单测里断言） ─────────

    /**
     * 归一化文本：null 与纯空白都收敛成空串，其余去掉首尾空白。
     *
     * 令牌是从 HTTP 头、剪贴板或手输流转过来的，首尾常带空白（换行最常见），
     * 原样存下去下次拼进 `Authorization` 头就会变成非法请求。
     */
    static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    /**
     * 归一化后是否算「有会话」。
     *
     * **空值一律当没有**：存一个空串会让前端 `session.load` 拿到 `refreshToken: ""`，
     * 于是它以为「有会话」，冷启动直接跳过登录页去刷新令牌，却只能拿到 401，
     * 表现为「打开应用闪一下又回到登录页」。因此空串必须与「没存过」完全等价。
     */
    static boolean isPresent(String token) {
        return !normalize(token).isEmpty();
    }

    // ── 读写 ───────────────────────────────────────────────────────

    /**
     * 写入会话：`token` 归一化后为空则等价于 {@link #clear}。
     *
     * 返回真正落盘的状态，便于调用方（以及单测）核对，不必再读一次盘。
     */
    public static State save(Context context, String token, String username) {
        State next = new State(normalize(token), normalize(username));
        if (next.refreshToken.isEmpty()) {
            // 空令牌不是「登录了一个没有令牌的用户」，而是「没有会话」：直接清干净，
            // 连用户名一起清掉——留着用户名会让登录页显示成「上次登录 xxx」却仍然要求密码。
            prefs(context).edit().remove(KEY_REFRESH_TOKEN).remove(KEY_USERNAME).apply();
            return State.empty();
        }
        prefs(context).edit()
                .putString(KEY_REFRESH_TOKEN, next.refreshToken)
                .putString(KEY_USERNAME, next.username)
                .apply();
        return next;
    }

    /** 读取刷新令牌；没有会话时返回空串，不返回 null。 */
    public static String refreshToken(Context context) {
        return normalize(prefs(context).getString(KEY_REFRESH_TOKEN, ""));
    }

    /** 读取上次登录的用户名；只用于登录页回填，没有时返回空串。 */
    public static String username(Context context) {
        return normalize(prefs(context).getString(KEY_USERNAME, ""));
    }

    /** 一次性读回会话，避免桥接层分两次读盘。 */
    public static State load(Context context) {
        return new State(refreshToken(context), username(context));
    }

    /** 退出登录：两个键一起清，避免残留用户名让登录页回填出「还在登录」的错觉。 */
    public static void clear(Context context) {
        prefs(context).edit().remove(KEY_REFRESH_TOKEN).remove(KEY_USERNAME).apply();
    }

    // ── 会话快照 ───────────────────────────────────────────────────

    /**
     * 一份会话快照，也是 {@link #save} / {@link #load} 的实际状态机。
     *
     * `save` 与 `clear` 在真机上只是「归一化 → 写哪几个键」这一步有分支，
     * 而 {@code SharedPreferences} 在纯 JVM 单测里拿不到实例。于是把这一步做成
     * 不可变值对象：测试断言 `State` 的行为，真机代码复用同一套判断
     * （与 `AppSettings.splitFormats` 用纯函数测切分的做法一致，不引入 Robolectric）。
     */
    static final class State {
        final String refreshToken;
        final String username;

        State(String refreshToken, String username) {
            this.refreshToken = normalize(refreshToken);
            this.username = normalize(username);
        }

        static State empty() {
            return new State("", "");
        }

        boolean present() {
            return isPresent(refreshToken);
        }

        /** 按同一条规则算出「保存一次之后」的状态。 */
        State apply(String token, String name) {
            if (!isPresent(token)) {
                return empty();
            }
            return new State(token, name);
        }
    }
}
