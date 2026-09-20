package com.example.calmobile;

import android.app.Activity;
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

    /** 前端调用入口，{@code callbackId} 由前端生成并用于匹配响应。 */
    @JavascriptInterface
    public void invoke(final String action, final String payloadJson, final String callbackId) {
        final Map<String, Object> payload = parsePayload(payloadJson);
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                dispatch(action, payload, callbackId);
            }
        });
    }

    /** 前端上报的异常，仅用于日志排查。 */
    @JavascriptInterface
    public void report(String message) {
        Log.w(TAG, "web error: " + message);
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
        } catch (Exception error) {
            Log.e(TAG, "动作执行失败: " + action, error);
            callback.failure("操作失败：" + error.getClass().getSimpleName());
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
        } catch (Exception error) {
            Log.w(TAG, "payload 解析失败: " + payloadJson, error);
            return new HashMap<>();
        }
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
        final String payload = data == null ? "null" : gson.toJson(data);
        final String message = error == null ? "''" : gson.toJson(error);
        final String codeArg = code == null ? "null" : gson.toJson(code);
        webView.post(new Runnable() {
            @Override
            public void run() {
                String script = "window.CalMobileBridge&&window.CalMobileBridge.onResult("
                        + quote(callbackId) + "," + ok + "," + payload + "," + message + ","
                        + codeArg + ");";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private static String quote(String value) {
        return value == null ? "''" : "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
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
        } catch (Exception error) {
            pendingResults.remove(requestCode);
            pending.callback.failure("无法打开系统界面：" + error.getMessage());
        }
    }

    /** 权限申请同样按 requestCode 登记回调，回调中没有 Intent 数据。 */
    void registerPermission(int requestCode, PendingResult pending) {
        pendingResults.put(requestCode, pending);
    }

    /** 由 {@link WebShellActivity} 转发 onActivityResult。 */
    void onActivityResult(int requestCode, int resultCode, Intent data) {
        PendingResult pending = pendingResults.remove(requestCode);
        if (pending != null) {
            WebAppActions.onActivityResult(this, pending, resultCode, data);
        }
    }

    /** 由 {@link WebShellActivity} 转发 onRequestPermissionsResult。 */
    void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        PendingResult pending = pendingResults.remove(requestCode);
        if (pending == null) {
            return;
        }
        boolean granted = grantResults.length > 0;
        for (int result : grantResults) {
            if (result != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                granted = false;
                break;
            }
        }
        WebAppActions.onPermissionResult(this, pending, granted);
    }
}
