package com.example.calmobile;

import android.app.Activity;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;

/**
 * 通行密钥（WebAuthn）的系统能力：交给 Android Credential Manager 完成。
 *
 * **为什么留在原生**：WebView 里 `navigator.credentials` 不可靠（多数版本没有 WebAuthn），
 * 而系统凭据提供方（Android 14 的 Credential Manager，低版本由 Google Play 服务提供）
 * 能直接用指纹 / 面容 / 锁屏密码完成同一件事。因此页面在 App 里改走这三条桥接动作：
 *
 * | 动作 | 作用 |
 * | --- | --- |
 * | `passkey.available` | 设备上有没有可用的凭据提供方 |
 * | `passkey.create` | 注册：把服务端下发的创建选项 JSON 原样交给系统 |
 * | `passkey.get` | 断言：用已绑定的凭据确认身份 |
 *
 * 选项与响应都是**标准 WebAuthn JSON**（base64url 字符串），所以服务端的校验逻辑不用区分
 * 页面跑在 App 还是浏览器里。App 的 clientDataJSON 里 origin 是
 * `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`，服务端的 WEBAUTHN_ORIGINS 要包含它。
 *
 * 用户取消统一回 `cancelled`（前端据此静默），其余失败带一句能照着做的说明。
 */
final class PasskeyActions {

    private static final String TAG = "PasskeyActions";

    /** Credential Manager 的回调要回主线程：桥接结果最终也是回主线程写回页面。 */
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Executor MAIN_EXECUTOR = command -> MAIN.post(command);

    private PasskeyActions() {
    }

    /** 设备上能不能用通行密钥：没有凭据提供方（例如没有 Play 服务的精简系统）时为 false。 */
    static void available(WebAppBridge bridge, WebAppBridge.ResultCallback callback) {
        boolean supported = false;
        try {
            CredentialManager.create(bridge.activity().getApplicationContext());
            supported = true;
        } catch (Throwable error) {
            Log.w(TAG, "设备没有可用的凭据提供方", error);
        }
        Map<String, Object> result = new HashMap<>();
        result.put("supported", supported);
        callback.success(result);
    }

    /** 注册一枚通行密钥。 */
    static void create(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String optionsJson = text(payload, "optionsJson");
        if (optionsJson.isEmpty()) {
            callback.failure("缺少通行密钥创建选项");
            return;
        }
        Activity activity = bridge.activity();
        try {
            CredentialManager manager = CredentialManager.create(activity);
            CreatePublicKeyCredentialRequest request = new CreatePublicKeyCredentialRequest(optionsJson);
            manager.createCredentialAsync(activity, request, new CancellationSignal(), MAIN_EXECUTOR,
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override
                        public void onResult(CreateCredentialResponse result) {
                            if (result instanceof CreatePublicKeyCredentialResponse) {
                                Map<String, Object> data = new HashMap<>();
                                data.put("credentialJson",
                                        ((CreatePublicKeyCredentialResponse) result).getRegistrationResponseJson());
                                callback.success(data);
                                return;
                            }
                            callback.failure("设备没有返回通行密钥");
                        }

                        @Override
                        public void onError(CreateCredentialException error) {
                            if (error instanceof CreateCredentialCancellationException) {
                                callback.failure(WebAppBridge.CODE_CANCELLED, "已取消添加通行密钥");
                                return;
                            }
                            Log.w(TAG, "添加通行密钥失败", error);
                            callback.failure(messageOf(error));
                        }
                    });
        } catch (Exception error) {
            Log.w(TAG, "无法发起通行密钥注册", error);
            callback.failure(messageOf(error));
        }
    }

    /** 用已绑定的通行密钥做断言（登录）。 */
    static void get(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String optionsJson = text(payload, "optionsJson");
        if (optionsJson.isEmpty()) {
            callback.failure("缺少通行密钥认证选项");
            return;
        }
        Activity activity = bridge.activity();
        try {
            CredentialManager manager = CredentialManager.create(activity);
            GetPublicKeyCredentialOption option = new GetPublicKeyCredentialOption(optionsJson);
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(option)
                    .build();
            manager.getCredentialAsync(activity, request, new CancellationSignal(), MAIN_EXECUTOR,
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            if (result.getCredential() instanceof PublicKeyCredential) {
                                Map<String, Object> data = new HashMap<>();
                                data.put("credentialJson",
                                        ((PublicKeyCredential) result.getCredential()).getAuthenticationResponseJson());
                                callback.success(data);
                                return;
                            }
                            callback.failure("设备返回的不是通行密钥凭据");
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            if (error instanceof GetCredentialCancellationException) {
                                callback.failure(WebAppBridge.CODE_CANCELLED, "已取消通行密钥验证");
                                return;
                            }
                            Log.w(TAG, "通行密钥验证失败", error);
                            callback.failure(messageOf(error));
                        }
                    });
        } catch (Exception error) {
            Log.w(TAG, "无法发起通行密钥验证", error);
            callback.failure(messageOf(error));
        }
    }

    private static String text(Map<String, Object> payload, String key) {
        Object value = payload == null ? null : payload.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    /**
     * 异常消息优先用系统给的说明；没有说明时带上错误类型（例如
     * `androidx.credentials.TYPE_CREATE_PUBLIC_KEY_CREDENTIAL_DOM_EXCEPTION`），
     * 至少能定位是哪一类失败，而不是一句空话。
     */
    private static String messageOf(Exception error) {
        String detail = error.getMessage() == null ? "" : error.getMessage().trim();
        if (!detail.isEmpty()) return detail;
        String type = "";
        if (error instanceof GetCredentialException) {
            type = ((GetCredentialException) error).getType();
        } else if (error instanceof CreateCredentialException) {
            type = ((CreateCredentialException) error).getType();
        }
        if (type != null && !type.trim().isEmpty()) {
            return "设备无法完成这次通行密钥操作（" + type + "）";
        }
        return "通行密钥操作失败";
    }
}
