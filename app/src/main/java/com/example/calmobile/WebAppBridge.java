package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * WebView 前端与 Android 业务层之间的唯一通道。
 * <p>
 * 前端通过 {@code window.CalMobileNative.invoke(action, payloadJson, callbackId)} 调用，
 * 原生处理后回调 {@code window.CalMobileBridge.onResult(callbackId, ok, resultJson, errorMessage)}。
 * JavaScript 接口方法运行在 WebView 的 JavaScript 线程，因此所有业务动作都会切回主线程执行，
 * 结果再统一写回前端。
 */
public class WebAppBridge {

    private static final String TAG = "WebAppBridge";

    /** 需要原生界面返回结果的动作，供 {@link WebAppActions} 使用。 */
    interface ResultCallback {
        void success(Object data);

        void failure(String message);

        /**
         * 带**稳定错误码**的失败。
         *
         * 前端按 `error.code` 判断可预期的结果（例如用户在系统界面点了取消），
         * 而不是去匹配失败文案——文案是给人看的，随时会改，靠子串匹配会
         * 「文案一改，取消分支集体失效」或者「某条真失败的文案里恰好含取消二字被吞掉」。
         */
        default void failure(String code, String message) {
            failure(message);
        }
    }

    /** 用户在系统界面取消：前端据此静默返回，不弹错误。 */
    static final String CODE_CANCELLED = "cancelled";
    /** 原生动作迟迟不回调（前端兜底超时用）。 */
    static final String CODE_TIMEOUT = "timeout";
    /**
     * 这个壳没有该动作：页面据此退回浏览器实现（旧 APK + 新页面的能力协商，见
     * {@link ShellCapabilities}）。与「动作执行失败」区分开，后者没有稳定错误码。
     */
    static final String CODE_UNSUPPORTED = "unsupported";

    /** 启动系统界面或申请权限时暂存的前端回调。 */
    static final class PendingResult {
        final String action;
        final ResultCallback callback;
        /** 等待系统界面期间透传的数据，例如待写入的 CSV 内容。 */
        final Map<String, Object> context = new HashMap<>();

        PendingResult(String action, ResultCallback callback) {
            this.action = action;
            this.callback = callback;
        }
    }

    private final Activity activity;
    private final WebView webView;
    private final Gson gson;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger requestCodes = new AtomicInteger(6000);
    private final Map<Integer, PendingResult> pendingResults = new HashMap<>();

    WebAppBridge(Activity activity, WebView webView, Gson gson) {
        this.activity = activity;
        this.webView = webView;
        this.gson = gson;
    }

    // ── JavaScript 入口 ────────────────────────────────────────

    /**
     * 前端调用入口，{@code callbackId} 由前端生成并用于匹配响应。
     *
     * 整个入口都包了 Throwable：JavaScript 接口方法运行在 WebView 的 JS 线程，
     * 这里漏出去的异常不会被业务层捕获，最坏会把 WebView 或进程一起带走。
     * 出错就回一条中文失败（能回的话），绝不把异常抛给 WebView。
     */
    @JavascriptInterface
    public void invoke(final String action, final String payloadJson, final String callbackId) {
        try {
            final Map<String, Object> payload = parsePayload(payloadJson);
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (!pageAllowed()) {
                            respond(callbackId, false, null, "当前页面不能使用设备能力", null);
                            return;
                        }
                        dispatch(action, payload, callbackId);
                    } catch (Throwable error) {
                        // dispatch 自己已经兜了一层；这里防的是 pageAllowed 等外围代码。
                        Log.e(TAG, "桥接动作执行失败: " + action, error);
                        respond(callbackId, false, null, "操作失败，请稍后再试", null);
                    }
                }
            });
        } catch (Throwable error) {
            Log.e(TAG, "桥接调用失败: " + action, error);
            try {
                respond(callbackId, false, null, "操作失败，请稍后再试", null);
            } catch (Throwable ignored) {
                Log.e(TAG, "失败结果也送不回页面: " + callbackId, ignored);
            }
        }
    }

    /** 前端上报的异常，仅用于日志排查。不是应用页面时丢弃。 */
    @JavascriptInterface
    public void report(final String message) {
        try {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (pageAllowed()) {
                            Log.w(TAG, "web error: " + message);
                        }
                    } catch (Throwable error) {
                        Log.w(TAG, "日志上报处理失败", error);
                    }
                }
            });
        } catch (Throwable error) {
            Log.w(TAG, "日志上报无法排队", error);
        }
    }

    // ── 外观（同步入口，不是动作） ──────────────────────────────

    /**
     * 首页首帧用的系统外观：{@code index.html} 的内联脚本在 {@code <head>} 里同步取它。
     *
     * 不走动作表与回调——异步回调来不及（首帧已经画完），而且它必须早于页面脚本有答案。
     * 只读设备事实（外观模式 + 系统 uiMode），没有业务数据，因此不做页面地址校验；
     * 也不碰 WebView：JavaScript 接口运行在 WebView 的 JS 线程，跨线程读 WebView 状态不安全。
     */
    @JavascriptInterface
    public String systemAppearance() {
        return systemAppearanceJson(activity);
    }

    /**
     * 系统外观 JSON（同步接口与配置变化的页面通知共用）。
     * 读偏好与系统配置都是线程安全的，因此可以从 JavaScript 线程直接调用。
     */
    static String systemAppearanceJson(Context context) {
        return appearanceJson(AppSettings.getUiMode(context), AppSettings.isSystemDark(context));
    }

    /**
     * 外观 JSON 的拼法：{@code {"systemDark":true,"mode":"auto"}}。
     *
     * {@code mode} 已归一化为 auto / light / dark，不含需要转义的字符，所以直接拼字符串，
     * 不引入 JSON 库。纯函数，便于在普通 JVM 单测里钉住字段名与归一化结果。
     */
    static String appearanceJson(String mode, boolean systemDark) {
        return "{\"systemDark\":" + systemDark + ",\"mode\":\"" + AppSettings.normalizeMode(mode) + "\"}";
    }

    /** 桥只对应用页面文档开放。必须在主线程读 WebView 的当前地址。 */
    private boolean pageAllowed() {
        try {
            String url = webView == null ? null : webView.getUrl();
            return PageOrigin.isAppDocument(url, BuildConfig.APP_ORIGIN);
        } catch (Throwable error) {
            // 地址读不出来（WebView 已释放）时按「不允许」处理：宁可拒绝，不能放行。
            Log.w(TAG, "读取页面地址失败，按非应用页面处理", error);
            return false;
        }
    }

    private void dispatch(String action, Map<String, Object> payload, final String callbackId) {
        ResultCallback callback = new ResultCallback() {
            @Override
            public void success(Object data) {
                respond(callbackId, true, data, null, null);
            }

            @Override
            public void failure(String message) {
                respond(callbackId, false, null, message, null);
            }

            @Override
            public void failure(String code, String message) {
                respond(callbackId, false, null, message, code);
            }
        };
        try {
            WebAppActions.handle(this, action, payload, callback);
        } catch (Throwable error) {
            // 只 catch Exception 会漏掉 NoClassDefFoundError / ExceptionInInitializerError
            // 这类 Error，它们逃到主线程 Looper 就是一次闪退。这里一律翻成可读失败。
            Log.e(TAG, "动作执行失败: " + action, error);
            callback.failure(readableFailure(error));
        }
    }

    private Map<String, Object> parsePayload(String payloadJson) {
        if (payloadJson == null || payloadJson.trim().isEmpty() || "null".equals(payloadJson.trim())) {
            return new HashMap<>();
        }
        try {
            JsonObject object = JsonParser.parseString(payloadJson).getAsJsonObject();
            Map<String, Object> map = gson.fromJson(object, Map.class);
            return map == null ? new HashMap<String, Object>() : map;
        } catch (Throwable error) {
            // 页面传坏了参数是可能的：按空参数处理，由动作自己判缺哪些字段并回中文。
            Log.w(TAG, "payload 解析失败: " + payloadJson, error);
            return new HashMap<>();
        }
    }

    /**
     * 业务动作抛错时给页面的一句中文。
     *
     * 不拼异常类名：中文界面里冒出 {@code IllegalStateException} 对用户没有意义；
     * 具体类型与堆栈只进 logcat（调用方已经记过）。
     */
    private static String readableFailure(Throwable error) {
        return error instanceof IllegalArgumentException
                ? "操作参数不完整，请重试"
                : "操作失败，请稍后再试";
    }

    /** 把结果写回前端，可从任意线程调用。 */
    void respond(final String callbackId, final boolean ok, final Object data, final String error) {
        respond(callbackId, ok, data, error, null);
    }

    /**
     * 把结果写回前端（带稳定错误码）。
     *
     * `onResult` 的第 5 个参数是错误码，可为 null：页面按 `error.code` 判断可预期的失败
     * （例如取消），不必匹配文案。
     */
    void respond(final String callbackId, final boolean ok, final Object data, final String error,
            final String code) {
        final String payload;
        final String message;
        final String codeArg;
        try {
            payload = data == null ? "null" : gson.toJson(data);
            message = error == null ? "''" : gson.toJson(error);
            codeArg = code == null ? "null" : gson.toJson(code);
        } catch (Throwable failure) {
            // 结果无法序列化（正常不会发生）也不能让回调线程倒下：改成一条可读失败再回。
            Log.e(TAG, "桥接结果序列化失败，改回失败结果", failure);
            respond(callbackId, false, null, "操作结果无法返回，请重试", null);
            return;
        }
        try {
            webView.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        webView.evaluateJavascript(
                                resultScript(callbackId, ok, payload, message, codeArg), null);
                    } catch (Throwable failure) {
                        // 页面可能已经销毁或 WebView 已释放：写回失败只能记日志，不能影响主线程。
                        Log.w(TAG, "写回页面结果失败: " + callbackId, failure);
                    }
                }
            });
        } catch (Throwable failure) {
            Log.w(TAG, "结果无法排队写回页面: " + callbackId, failure);
        }
    }

    /**
     * 拼出写回页面的脚本。
     *
     * payload / message / codeArg 都是 JSON 文本（JSON 是 JavaScript 对象的子集，可直接当字面量）；
     * 只有 callbackId 需要按 JS 字符串转义，见 {@link #quote(String)}。
     * 纯函数，便于在 JVM 单测里钉住参数顺序与转义。
     */
    static String resultScript(String callbackId, boolean ok, String payload, String message, String codeArg) {
        return "window.CalMobileBridge&&window.CalMobileBridge.onResult("
                + quote(callbackId) + "," + ok + "," + payload + "," + message + "," + codeArg + ");";
    }

    /**
     * 把字符串变成 JS 字符串字面量。
     *
     * 只转义反斜杠和单引号不够：换行与 U+2028 / U+2029 在 JS 里是行终止符，拼进脚本会让
     * 整段变成语法错误，页面永远等不到回调（看起来就是「点了没反应」）。这里把控制字符与
     * 行分隔符一律写成反斜杠 + u + 四位十六进制的形式，拼出来的脚本对任何输入都还是合法表达式。
     */
    static String quote(String value) {
        if (value == null) {
            return "''";
        }
        StringBuilder out = new StringBuilder(value.length() + 2);
        out.append('\'');
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            switch (current) {
                case '\\':
                    out.append("\\\\");
                    break;
                case '\'':
                    out.append("\\'");
                    break;
                default:
                    if (current < 0x20 || current == 0x2028 || current == 0x2029) {
                        out.append("\\u");
                        String hex = Integer.toHexString(current);
                        for (int pad = hex.length(); pad < 4; pad++) {
                            out.append('0');
                        }
                        out.append(hex);
                    } else {
                        out.append(current);
                    }
            }
        }
        out.append('\'');
        return out.toString();
    }

    // ── payload 取值辅助 ───────────────────────────────────────

    static String text(Map<String, Object> payload, String key, String fallback) {
        Object value = payload.get(key);
        if (value == null) {
            return fallback;
        }
        // 列表按逗号拼，不要用 List 的 toString：那会带上 `[]`，而设备侧是按逗号切分的
        // （格式白名单就是这么传的，写成 `[mp4,mov,webm]` 会让 mp4 也被判成非法）。
        String text;
        if (value instanceof List) {
            StringBuilder joined = new StringBuilder();
            for (Object item : (List<?>) value) {
                if (item == null) {
                    continue;
                }
                if (joined.length() > 0) {
                    joined.append(',');
                }
                joined.append(String.valueOf(item).trim());
            }
            text = joined.toString();
        } else {
            text = String.valueOf(value);
        }
        return text.isEmpty() ? fallback : text;
    }

    static boolean flag(Map<String, Object> payload, String key, boolean fallback) {
        Object value = payload.get(key);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value != null) {
            return Boolean.parseBoolean(String.valueOf(value));
        }
        return fallback;
    }

    static int number(Map<String, Object> payload, String key, int fallback) {
        Object value = payload.get(key);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value != null) {
            try {
                return (int) Double.parseDouble(String.valueOf(value));
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (value instanceof List) {
            return (List<Object>) value;
        }
        return new java.util.ArrayList<>();
    }

    /** 取一个嵌套对象（例如 ui.sync 里的 media / upload），不是对象时给空表。 */
    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Map<String, Object> payload, String key) {
        Object value = payload == null ? null : payload.get(key);
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }
        return new java.util.LinkedHashMap<>();
    }

    // ── 系统界面结果回调 ───────────────────────────────────────

    Activity activity() {
        return activity;
    }

    Gson gson() {
        return gson;
    }

    int nextRequestCode() {
        return requestCodes.getAndIncrement();
    }

    /** 启动需要结果的系统界面并登记回调。 */
    void startForResult(Intent intent, int requestCode, PendingResult pending) {
        pendingResults.put(requestCode, pending);
        try {
            activity.startActivityForResult(intent, requestCode);
        } catch (Throwable error) {
            // 系统没有能应答的界面（ActivityNotFound 等）不能挂住页面的 Promise，也不能崩进程。
            pendingResults.remove(requestCode);
            Log.w(TAG, "无法打开系统界面: " + pending.action, error);
            try {
                pending.callback.failure("无法打开系统界面，请稍后再试");
            } catch (Throwable ignored) {
                Log.w(TAG, "失败结果送不回页面: " + pending.action, ignored);
            }
        }
    }

    /** 权限申请同样按 requestCode 登记回调，回调中没有 Intent 数据。 */
    void registerPermission(int requestCode, PendingResult pending) {
        pendingResults.put(requestCode, pending);
    }

    /** 由 {@link WebShellActivity} 转发 onActivityResult。 */
    void onActivityResult(int requestCode, int resultCode, Intent data) {
        PendingResult pending = pendingResults.remove(requestCode);
        if (pending == null) {
            return;
        }
        try {
            WebAppActions.onActivityResult(this, pending, resultCode, data);
        } catch (Throwable error) {
            // 这里跑在 Activity.onActivityResult 的主线程上：漏出去就是闪退。
            Log.e(TAG, "处理系统界面结果失败: " + pending.action, error);
            try {
                pending.callback.failure("系统界面返回的结果无法处理，请重试");
            } catch (Throwable ignored) {
                Log.w(TAG, "失败结果送不回页面: " + pending.action, ignored);
            }
        }
    }

    /** 由 {@link WebShellActivity} 转发 onRequestPermissionsResult。 */
    void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        PendingResult pending = pendingResults.remove(requestCode);
        if (pending == null) {
            return;
        }
        try {
            boolean granted = grantResults != null && grantResults.length > 0;
            if (granted) {
                for (int result : grantResults) {
                    if (result != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        granted = false;
                        break;
                    }
                }
            }
            WebAppActions.onPermissionResult(this, pending, granted);
        } catch (Throwable error) {
            Log.e(TAG, "处理权限结果失败: " + pending.action, error);
            try {
                pending.callback.failure("权限申请结果无法处理，请重试");
            } catch (Throwable ignored) {
                Log.w(TAG, "失败结果送不回页面: " + pending.action, ignored);
            }
        }
    }
}
