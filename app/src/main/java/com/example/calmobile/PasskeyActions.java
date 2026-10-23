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
import androidx.credentials.exceptions.CreateCredentialInterruptedException;
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException;
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException;
import androidx.credentials.exceptions.CreateCredentialUnsupportedException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialInterruptedException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.GetCredentialUnsupportedException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.credentials.exceptions.domerrors.AbortError;
import androidx.credentials.exceptions.domerrors.DomError;
import androidx.credentials.exceptions.domerrors.NotAllowedError;
import androidx.credentials.exceptions.domerrors.TimeoutError;
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException;
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException;

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
 * **取消要按实际情况判定**：用户在系统面板上划掉或按返回时，凭据提供方回的是
 * `CreatePublicKeyCredentialDomException`（DOM 类型 AbortError / NotAllowedError / TimeoutError），
 * 不是 CancellationException —— 只认后者会把「用户自己关掉了面板」显示成一条失败提示。
 * 这三类 DOM 错误与 Cancellation / Interrupted 一起归成 `cancelled`，页面据此静默。
 *
 * 其余失败给一句**中文说明**：系统的英文原文（例如 `Request doesn't finish on time!`）
 * 只写进 logcat，不抛给用户。
 */
final class PasskeyActions {

    private static final String TAG = "PasskeyActions";

    /** 系统凭据服务另两个错误类型：库里没有对应常量类，按契约里的字符串比较。 */
    private static final String DOM_SECURITY_ERROR = "androidx.credentials.TYPE_SECURITY_ERROR";
    private static final String DOM_INVALID_STATE_ERROR = "androidx.credentials.TYPE_INVALID_STATE_ERROR";

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
                            fail(error, "添加通行密钥", "已取消添加通行密钥", callback);
                        }
                    });
        } catch (Exception error) {
            fail(error, "添加通行密钥", "已取消添加通行密钥", callback);
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
                            fail(error, "通行密钥验证", "已取消通行密钥验证", callback);
                        }
                    });
        } catch (Exception error) {
            fail(error, "通行密钥验证", "已取消通行密钥验证", callback);
        }
    }

    private static String text(Map<String, Object> payload, String key) {
        Object value = payload == null ? null : payload.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    /** 统一的失败出口：用户自己关掉面板算取消，其余给一句中文说明。 */
    private static void fail(Exception error, String action, String cancelledText,
            WebAppBridge.ResultCallback callback) {
        if (userGaveUp(error)) {
            callback.failure(WebAppBridge.CODE_CANCELLED, cancelledText);
            return;
        }
        Log.w(TAG, action + "失败", error);
        callback.failure(messageOf(error));
    }

    /**
     * 用户放弃这次操作：划掉面板、按返回、面板自己超时，或者系统打断了这次调用。
     * 这些都不该在页面上变成一条失败提示。
     */
    private static boolean userGaveUp(Exception error) {
        if (error instanceof CreateCredentialCancellationException
                || error instanceof GetCredentialCancellationException
                || error instanceof CreateCredentialInterruptedException
                || error instanceof GetCredentialInterruptedException) {
            return true;
        }
        DomError dom = domErrorOf(error);
        if (dom == null) {
            return false;
        }
        String type = dom.getType();
        return AbortError.TYPE_CREATE_PUBLIC_KEY_CREDENTIAL_ABORT_ERROR.equals(type)
                || NotAllowedError.TYPE_CREATE_PUBLIC_KEY_CREDENTIAL_NOT_ALLOWED_ERROR.equals(type)
                || TimeoutError.TYPE_CREATE_PUBLIC_KEY_CREDENTIAL_TIMEOUT_ERROR.equals(type);
    }

    /** 取失败里的 DOM 错误（注册与断言各有一种包装类）；不是 DOM 错误时返回 null。 */
    private static DomError domErrorOf(Exception error) {
        if (error instanceof CreatePublicKeyCredentialDomException) {
            return ((CreatePublicKeyCredentialDomException) error).getDomError();
        }
        if (error instanceof GetPublicKeyCredentialDomException) {
            return ((GetPublicKeyCredentialDomException) error).getDomError();
        }
        return null;
    }

    /**
     * 把失败翻译成用户能照着做的一句话。系统的英文原文与 DOM 类型留在 logcat，
     * 页面只拿中文，否则中文界面里会冒出 "Request doesn't finish on time!"。
     */
    private static String messageOf(Exception error) {
        if (error instanceof CreateCredentialNoCreateOptionException || error instanceof NoCredentialException) {
            return "这台设备上还没有能保存通行密钥的账户，先登录系统账号再试";
        }
        if (error instanceof CreateCredentialProviderConfigurationException
                || error instanceof GetCredentialProviderConfigurationException) {
            return "系统凭据服务还没准备好，重启应用或设备后再试";
        }
        if (error instanceof CreateCredentialUnsupportedException || error instanceof GetCredentialUnsupportedException) {
            return "这台设备不支持通行密钥，改用验证码登录";
        }
        DomError dom = domErrorOf(error);
        if (dom != null) {
            Log.w(TAG, "系统返回的通行密钥错误类型：" + dom.getType());
            if (DOM_INVALID_STATE_ERROR.equals(dom.getType())) {
                return "这个账号在这台设备上已经有通行密钥了";
            }
            if (DOM_SECURITY_ERROR.equals(dom.getType())) {
                return "系统拒绝了这次请求：域名与应用还没建立关联，检查部署配置后再试";
            }
            return "系统没能完成这次通行密钥操作，稍后再试";
        }
        return "通行密钥操作失败，稍后再试";
    }
}
