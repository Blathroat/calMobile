package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.Credential;
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

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 通行密钥（WebAuthn）的系统能力：交给 Android Credential Manager 完成。
 *
 * **为什么留在原生**：WebView 里 `navigator.credentials` 不可靠（多数版本没有 WebAuthn），
 * 而系统凭据提供方（Android 14 的 Credential Manager，低版本由 Google Play 服务提供）
 * 能直接用指纹 / 面容 / 锁屏密码完成同一件事。因此页面在 App 里改走这三条桥接动作：
 *
 * | 动作 | 作用 |
 * | --- | --- |
 * | `passkey.available` | 设备上有没有真正可用的凭据提供方 |
 * | `passkey.create` | 注册：把服务端下发的创建选项 JSON 交给系统 |
 * | `passkey.get` | 断言：用已绑定的凭据确认身份 |
 *
 * 选项与响应都是**标准 WebAuthn JSON**（base64url 字符串），所以服务端的校验逻辑不用区分
 * 页面跑在 App 还是浏览器里。App 的 clientDataJSON 里 origin 是
 * `android:apk-key-hash:<签名证书 SHA-256 的 base64url>`，服务端的 WEBAUTHN_ORIGINS 要包含它。
 *
 * **为什么整个文件都按「不信任任何输入、不放过任何 Throwable」写**：
 * Credential Manager 的回调经主线程 Handler 回到这里，回调体里抛出的任何 Throwable 都会
 * 直接终止进程（页面上就是一次闪退）。所以：
 * - 服务端下发的选项 JSON 进系统前先校验（空 / 超长 / 不是对象 / 缺关键字段都挡在本地），
 *   避免系统侧用英文异常拒绝；校验也顺带解释清楚「该重新发起还是该改配置」。
 * - 同步调用与 {@link CredentialManagerCallback#onResult} / {@link CredentialManagerCallback#onError}
 *   全部 catch Throwable：失败也要回页面一句中文，不能崩进程，也不能一声不响。
 * - 回调用 {@link OneShot} 包一层：系统回调重复触发时只认第一次，避免同一个 callbackId 收到两个结果。
 *
 * **取消要按实际情况判定**：用户在系统面板上划掉或按返回时，凭据提供方回的是
 * `CreatePublicKeyCredentialDomException`（DOM 类型 AbortError / NotAllowedError / TimeoutError），
 * 不是 CancellationException —— 只认后者会把「用户自己关掉了面板」显示成一条失败提示。
 * 这三类 DOM 错误与 Cancellation / Interrupted 一起归成 `cancelled`，页面据此静默。
 *
 * **可用性要真实**：`CredentialManager.create()` 只返回一个门面对象（androidx 1.3.0 的
 * `CredentialManagerImpl`），不检查设备上有没有凭据提供方；真正的判断在
 * `CredentialProviderFactory.getBestAvailableProvider()` / `isAvailableOnDevice()`。
 * 这里按同一套规则自己判断：API 34+ 看系统 credential 服务，没有时退回 Play 服务提供方；
 * API 33 及以下只有随包声明的 Play 服务提供方。判断在动手之前做，按钮才不会点了必然失败。
 *
 * 其余失败给一句**中文说明**：系统的英文原文只写进 logcat，不抛给用户。
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

    /** 设备上有没有真正能承接通行密钥的凭据提供方。 */
    static void available(WebAppBridge bridge, WebAppBridge.ResultCallback callback) {
        final WebAppBridge.ResultCallback once = once(callback);
        boolean supported = false;
        try {
            Activity activity = bridge.activity();
            Context context = activity == null ? null : activity.getApplicationContext();
            supported = Probe.supported(context);
            Log.i(TAG, "设备通行密钥可用性：" + supported);
        } catch (Throwable error) {
            // 判断本身失败按「不可用」收场：入口置灰比点开一个必然失败的流程好。
            Log.w(TAG, "探测通行密钥能力失败，按不可用处理", error);
        }
        Map<String, Object> result = new HashMap<>();
        result.put("supported", supported);
        once.success(result);
    }

    /** 注册一枚通行密钥。 */
    static void create(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        final WebAppBridge.ResultCallback once = once(callback);
        try {
            String optionsJson = text(payload, "optionsJson");
            String invalid = Options.createError(optionsJson);
            if (invalid != null) {
                once.failure(invalid);
                return;
            }
            Activity activity = bridge.activity();
            if (activity == null) {
                once.failure("当前页面不能添加通行密钥，重新打开应用后再试");
                return;
            }
            try {
                CredentialManager manager = CredentialManager.create(activity);
                CreatePublicKeyCredentialRequest request = new CreatePublicKeyCredentialRequest(optionsJson);
                manager.createCredentialAsync(activity, request, new CancellationSignal(), MAIN_EXECUTOR,
                        new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                            @Override
                            public void onResult(CreateCredentialResponse result) {
                                try {
                                    if (result instanceof CreatePublicKeyCredentialResponse) {
                                        String credentialJson =
                                                ((CreatePublicKeyCredentialResponse) result).getRegistrationResponseJson();
                                        if (credentialJson == null || credentialJson.trim().isEmpty()) {
                                            once.failure("设备没有返回通行密钥，稍后再试");
                                            return;
                                        }
                                        Map<String, Object> data = new HashMap<>();
                                        data.put("credentialJson", credentialJson);
                                        once.success(data);
                                        return;
                                    }
                                    once.failure("设备没有返回通行密钥，稍后再试");
                                } catch (Throwable error) {
                                    // 回调体在主线程：这里漏出去的 Throwable 会直接闪退。
                                    Log.e(TAG, "处理添加通行密钥结果失败", error);
                                    once.failure("系统返回的通行密钥数据无法识别，稍后再试");
                                }
                            }

                            @Override
                            public void onError(CreateCredentialException error) {
                                try {
                                    fail(error, "添加通行密钥", "已取消添加通行密钥", once);
                                } catch (Throwable unexpected) {
                                    Log.e(TAG, "添加通行密钥失败", unexpected);
                                    once.failure("添加通行密钥失败，稍后再试");
                                }
                            }
                        });
            } catch (Throwable error) {
                fail(error, "添加通行密钥", "已取消添加通行密钥", once);
            }
        } catch (Throwable error) {
            Log.e(TAG, "添加通行密钥失败", error);
            once.failure("添加通行密钥失败，稍后再试");
        }
    }

    /** 用已绑定的通行密钥做断言（登录）。 */
    static void get(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        final WebAppBridge.ResultCallback once = once(callback);
        try {
            String optionsJson = text(payload, "optionsJson");
            String invalid = Options.getError(optionsJson);
            if (invalid != null) {
                once.failure(invalid);
                return;
            }
            Activity activity = bridge.activity();
            if (activity == null) {
                once.failure("当前页面不能验证通行密钥，重新打开应用后再试");
                return;
            }
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
                                try {
                                    Credential credential = result == null ? null : result.getCredential();
                                    if (credential instanceof PublicKeyCredential) {
                                        String credentialJson =
                                                ((PublicKeyCredential) credential).getAuthenticationResponseJson();
                                        if (credentialJson == null || credentialJson.trim().isEmpty()) {
                                            once.failure("设备返回的通行密钥为空，稍后再试");
                                            return;
                                        }
                                        Map<String, Object> data = new HashMap<>();
                                        data.put("credentialJson", credentialJson);
                                        once.success(data);
                                        return;
                                    }
                                    once.failure("设备返回的不是通行密钥凭据，稍后再试");
                                } catch (Throwable error) {
                                    Log.e(TAG, "处理通行密钥验证结果失败", error);
                                    once.failure("系统返回的通行密钥数据无法识别，稍后再试");
                                }
                            }

                            @Override
                            public void onError(GetCredentialException error) {
                                try {
                                    fail(error, "通行密钥验证", "已取消通行密钥验证", once);
                                } catch (Throwable unexpected) {
                                    Log.e(TAG, "通行密钥验证失败", unexpected);
                                    once.failure("通行密钥验证失败，稍后再试");
                                }
                            }
                        });
            } catch (Throwable error) {
                fail(error, "通行密钥验证", "已取消通行密钥验证", once);
            }
        } catch (Throwable error) {
            Log.e(TAG, "通行密钥验证失败", error);
            once.failure("通行密钥验证失败，稍后再试");
        }
    }

    /** 选项 JSON 从页面传进来：只认字符串，其余类型当缺失，交给 {@link Options} 给中文说明。 */
    private static String text(Map<String, Object> payload, String key) {
        Object value = payload == null ? null : payload.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    /** 把回调包成「只回一次」：系统回调重复触发时忽略后一次，多线程下也不会写回两个结果。 */
    private static WebAppBridge.ResultCallback once(WebAppBridge.ResultCallback callback) {
        return new OneShot(callback);
    }

    /** 统一的失败出口：用户自己关掉面板算取消，其余给一句中文说明。 */
    private static void fail(Throwable error, String action, String cancelledText,
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
    private static boolean userGaveUp(Throwable error) {
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
    private static DomError domErrorOf(Throwable error) {
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
    private static String messageOf(Throwable error) {
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
        if (error instanceof IllegalArgumentException) {
            // 正常情况下选项已经在校验层挡住；走到这里说明服务端下发的字段仍不合系统要求。
            return "通行密钥选项不完整，重新发起一次再试";
        }
        if (error instanceof SecurityException) {
            return "系统拒绝了这次通行密钥请求，检查应用的域名关联配置后再试";
        }
        if (error instanceof LinkageError) {
            // 设备 ROM 裁掉了系统凭据组件时才会出现：属于系统环境问题，不是页面故障。
            return "这台设备的通行密钥组件不可用，改用验证码或换一台设备";
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

    /**
     * 设备可用性判断：与 androidx.credentials 1.3.0 的 provider 选择规则保持一致。
     *
     * 抽成不碰 Android 的纯函数（只看三个信号），JVM 单测可以直接钉住这些分支；
     * 真的读设备状态的部分在 {@link #supported(Context)}。
     */
    static final class Probe {

        /**
         * Play 服务提供方要求的最低 GMS 版本：抄自 androidx.credentials 1.3.0 的
         * CredentialProviderPlayServicesImpl.MIN_GMS_APK_VERSION。
         */
        static final long MIN_GMS_APK_VERSION = 230815045L;

        /** Play 服务的包名：只用于读版本号的兜底路径。 */
        private static final String PLAY_SERVICES_PACKAGE = "com.google.android.gms";

        private Probe() {
        }

        static boolean supported(Context context) {
            if (context == null) {
                return false;
            }
            int sdkInt = Build.VERSION.SDK_INT;
            boolean credentialService = sdkInt >= 34 && hasCredentialService(context);
            Boolean playServices = probePlayServices(context);
            if (playServices == null) {
                // 反射拿不到 GMS 检查器（极简 ROM 连类都裁掉）时退回读包版本。
                playServices = packageVersionSupported(packageVersion(context));
            }
            return supportedFromSignals(sdkInt, credentialService, playServices.booleanValue());
        }

        /**
         * @param sdkInt            设备 API 级别
         * @param credentialService API 34+ 上系统有没有 credential 服务（框架提供方）
         * @param playServices      设备上的 Play 服务能不能承接凭据提供方
         */
        static boolean supportedFromSignals(int sdkInt, boolean credentialService, boolean playServices) {
            if (sdkInt >= 34) {
                // API 34+ 优先框架提供方；框架服务缺席时 androidx 会退回随包的 Play 服务提供方。
                return credentialService || playServices;
            }
            // API 33 及以下只有随包声明的 Play 服务提供方，没有框架兜底。
            return playServices;
        }

        /** Play 服务版本是否达到 androidx 要求的最低版本；纯函数，便于钉住那条 230815045 的契约。 */
        static boolean packageVersionSupported(long gmsVersionCode) {
            return gmsVersionCode >= MIN_GMS_APK_VERSION;
        }

        /**
         * 用 GMS 自己的检查器判断 Play 服务是否可用 —— 与 androidx 的
         * CredentialProviderPlayServicesImpl.isAvailableOnDevice 调的是同一个 API。
         *
         * 走反射是因为 com.google.android.gms 只是 credentials-play-services-auth 的
         * runtime 依赖，app/build.gradle 里没有直接声明，不能编译期引用。
         * 也刻意不用 PackageManager.getPackageInfo 直接读版本号：Android 11+ 的包可见性
         * 要求 <queries> 声明，没声明时读 GMS 包会 NameNotFound，把有 Play 服务的设备
         * 误判成不可用；GMS 检查器内部怎么读，就按它的结果算。
         *
         * @return 可用性；类/方法取不到（极简 ROM）时返回 null，由调用方走版本号兜底
         */
        private static Boolean probePlayServices(Context context) {
            try {
                Class<?> availabilityClass = Class.forName("com.google.android.gms.common.GoogleApiAvailability");
                Object availability = availabilityClass.getMethod("getInstance").invoke(null);
                Object result = availabilityClass
                        .getMethod("isGooglePlayServicesAvailable", Context.class, int.class)
                        .invoke(availability, context, (int) MIN_GMS_APK_VERSION);
                // ConnectionResult.SUCCESS 是 0；缺服务 / 版本不够 / 被禁用都是其它值。
                return result instanceof Integer && ((Integer) result).intValue() == 0;
            } catch (Throwable error) {
                return null;
            }
        }

        private static boolean hasCredentialService(Context context) {
            try {
                // Context.CREDENTIAL_SERVICE 从 API 34 才有；字符串常量在低版本只是取不到服务。
                return context.getSystemService("credential") != null;
            } catch (Throwable error) {
                return false;
            }
        }

        @SuppressWarnings("deprecation") // versionCode 只有 API 28 以下才要用
        private static long packageVersion(Context context) {
            try {
                PackageInfo info = context.getPackageManager().getPackageInfo(PLAY_SERVICES_PACKAGE, 0);
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            } catch (Throwable error) {
                // 没装 Play 服务、或 Android 11+ 没声明 <queries>：都按不可用处理，不猜。
                return 0;
            }
        }
    }

    /**
     * 服务端下发选项 JSON 的本地校验。
     *
     * 系统侧（androidx.credentials）遇到不合法的 JSON 会抛 {@link IllegalArgumentException}，
     * 文案是英文、也分不清是服务端问题还是设备问题；所以在构造请求之前先挡下来，
     * 按「缺什么、该怎么办」给中文说明。字段要求抄自 WebAuthn 的
     * PublicKeyCredentialCreationOptionsJSON / PublicKeyCredentialRequestOptionsJSON：
     * 创建必须有 challenge、rp.id、user.id、user.name、pubKeyCredParams；
     * 断言必须有 challenge、rpId（allowCredentials 允许为空，交给系统发现可用凭据）。
     */
    static final class Options {

        /** 正常选项 2KB 上下；32KB 已经远超合理值，再大的只可能是服务端拼错了。 */
        static final int MAX_LENGTH = 32 * 1024;

        private static final String FORMAT_ERROR = "通行密钥选项格式不正确，重新发起一次再试";
        private static final String TOO_LONG_ERROR = "通行密钥选项过长，检查服务器配置后再试";

        private Options() {
        }

        /** 注册选项校验：合法返回 null，否则返回给用户看的中文说明。 */
        static String createError(String optionsJson) {
            String base = baseError(optionsJson, "缺少通行密钥创建选项，重新发起添加再试");
            if (base != null) {
                return base;
            }
            JsonObject object;
            try {
                object = JsonParser.parseString(optionsJson).getAsJsonObject();
            } catch (RuntimeException error) {
                return FORMAT_ERROR;
            }
            if (!hasText(object, "challenge")) {
                return "通行密钥选项缺少挑战值，重新发起添加再试";
            }
            JsonObject rp = objectOf(object, "rp");
            if (rp == null || !hasText(rp, "id")) {
                return "通行密钥选项缺少域名，检查服务器地址后再试";
            }
            JsonObject user = objectOf(object, "user");
            if (user == null || !hasText(user, "id") || !hasText(user, "name")) {
                return "通行密钥选项缺少账号信息，重新登录后再试";
            }
            JsonArray params = arrayOf(object, "pubKeyCredParams");
            if (params == null || params.isEmpty()) {
                return "通行密钥选项缺少算法列表，稍后再试";
            }
            return null;
        }

        /** 断言选项校验：合法返回 null，否则返回给用户看的中文说明。 */
        static String getError(String optionsJson) {
            String base = baseError(optionsJson, "缺少通行密钥认证选项，重新发起验证再试");
            if (base != null) {
                return base;
            }
            JsonObject object;
            try {
                object = JsonParser.parseString(optionsJson).getAsJsonObject();
            } catch (RuntimeException error) {
                return FORMAT_ERROR;
            }
            if (!hasText(object, "challenge")) {
                return "通行密钥选项缺少挑战值，重新发起验证再试";
            }
            if (!hasText(object, "rpId")) {
                return "通行密钥选项缺少域名，检查服务器地址后再试";
            }
            return null;
        }

        /** 两种选项共用：非空、长度上限、必须是 JSON 对象（数组 / 字符串 / null 都不行）。 */
        private static String baseError(String optionsJson, String missingText) {
            if (optionsJson == null) {
                return missingText;
            }
            String trimmed = optionsJson.trim();
            if (trimmed.isEmpty()) {
                return missingText;
            }
            if (optionsJson.length() > MAX_LENGTH) {
                return TOO_LONG_ERROR;
            }
            if (!trimmed.startsWith("{")) {
                return FORMAT_ERROR;
            }
            return null;
        }

        private static JsonObject objectOf(JsonObject object, String key) {
            if (object == null || !object.has(key)) {
                return null;
            }
            JsonElement value = object.get(key);
            return value != null && value.isJsonObject() ? value.getAsJsonObject() : null;
        }

        private static JsonArray arrayOf(JsonObject object, String key) {
            if (object == null || !object.has(key)) {
                return null;
            }
            JsonElement value = object.get(key);
            return value != null && value.isJsonArray() ? value.getAsJsonArray() : null;
        }

        /** 字符串字段必须存在且非空白；数字、布尔、null 都不算。 */
        private static boolean hasText(JsonObject object, String key) {
            if (object == null || !object.has(key)) {
                return false;
            }
            JsonElement value = object.get(key);
            return value != null
                    && value.isJsonPrimitive()
                    && value.getAsJsonPrimitive().isString()
                    && !value.getAsString().trim().isEmpty();
        }
    }

    /** 只回一次的回调包装：防止系统重复回调把同一个 callbackId 写回两次，也吞掉写回时的异常。 */
    private static final class OneShot implements WebAppBridge.ResultCallback {

        private final WebAppBridge.ResultCallback delegate;
        private final AtomicBoolean answered = new AtomicBoolean();

        OneShot(WebAppBridge.ResultCallback delegate) {
            this.delegate = delegate;
        }

        @Override
        public void success(Object data) {
            if (!claim()) {
                return;
            }
            try {
                delegate.success(data);
            } catch (Throwable error) {
                Log.e(TAG, "写回通行密钥结果失败", error);
            }
        }

        @Override
        public void failure(String message) {
            if (!claim()) {
                return;
            }
            try {
                delegate.failure(message);
            } catch (Throwable error) {
                Log.e(TAG, "写回通行密钥失败结果失败", error);
            }
        }

        @Override
        public void failure(String code, String message) {
            if (!claim()) {
                return;
            }
            try {
                delegate.failure(code, message);
            } catch (Throwable error) {
                Log.e(TAG, "写回通行密钥失败结果失败", error);
            }
        }

        private boolean claim() {
            if (answered.compareAndSet(false, true)) {
                return true;
            }
            Log.w(TAG, "系统重复回调通行密钥结果，忽略后一次");
            return false;
        }
    }
}
