package com.example.calmobile;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.gson.Gson;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * WebView 前端容器。
 * <p>
 * 文档地址是接口所在源的 {@code /app/index.html}。{@code /app/} 的请求由本机快照或包内页面应答，
 * 页面切换不再访问网络。正式包在首屏出来之后才后台核对热更新，新文件留到下次冷启动。
 * 设备上选中的媒体仍映射到 {@code https://appassets.androidplatform.net/media/}。
 * 所有业务调用统一走 {@link WebAppBridge}。
 */
public class WebShellActivity extends Activity {

    /** 用户上传的图片与视频的虚拟目录：内容存放在应用私有目录，URL 里只出现文件名。 */
    public static final String MEDIA_URL = "https://appassets.androidplatform.net/media/";

    private static final String TAG = "WebShellActivity";

    /** API 35 起这个调用已过时，但 30–34 仍要靠它让出系统栏，否则内边距会叠两层。 */
    @SuppressWarnings("deprecation")
    private void drawBehindSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }
    }

    /**
     * 把状态栏、导航栏和键盘让出来。
     *
     * inset 收成容器内边距后就吃掉，避免 WebView 再按同一块区域垫一层。
     * 只在 API 30 及以上调用：更早的系统仍由窗口自己避开系统栏。
     */
    private static WindowInsets padForSystemBars(View view, WindowInsets insets) {
        int barTypes = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
        Insets bars = insets.getInsets(barTypes);
        int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        view.setPadding(bars.left, bars.top, bars.right, bottom);
        return new WindowInsets.Builder(insets)
                .setInsets(WindowInsets.Type.systemBars(), Insets.NONE)
                .setInsets(WindowInsets.Type.displayCutout(), Insets.NONE)
                .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                .build();
    }

    /** 上传文件的落盘目录（files/media），图片以短 URL 引用，避免把 base64 写进长简介。 */
    public static File mediaDir(Context context) {
        File dir = new File(context.getFilesDir(), "media");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "无法创建媒体目录: " + dir);
        }
        return dir;
    }

    /** 文件选择器 requestCode 的起点：1000 起自增，桥的区间从 6000 开始，两边不会撞。 */
    private static final int FILE_CHOOSER_REQUEST_BASE = 1000;
    /** 桥的 requestCode 起点（{@link WebAppBridge#nextRequestCode()}），文件选择器不能越过它。 */
    private static final int BRIDGE_REQUEST_CODE_BASE = 6000;

    private WebView webView;
    private WebAppBridge bridge;
    /** 这次进程读的页面目录。null 表示用 APK 里的那份。进程内不替换。 */
    private File pageFiles;
    private boolean hotUpdateStarted;

    /**
     * WebView 里 `<input type="file">`（语言包「从文件安装」）的回调表。
     * 系统选择器返回前按 requestCode 暂存，返回后立刻移除，避免泄漏和下一次选择拿不到结果。
     */
    private final Map<Integer, ValueCallback<Uri[]>> fileChooserCallbacks = new HashMap<>();

    private int nextFileChooserRequestCode = FILE_CHOOSER_REQUEST_BASE;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppSettings.applyWindowColors(this);
        // targetSdk 35 起窗口默认铺到系统栏下面。WebView 里的
        // env(safe-area-inset-*) 经常仍是 0，顶栏会压住状态栏，底栏会贴进导航栏。
        // API 30–34 仍要自己关掉「装饰避开系统栏」，否则内边距会再垫一层。
        drawBehindSystemBars();

        FrameLayout container = new FrameLayout(this);
        container.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // 底色跟随外观模式，深色模式下不会在页面切换时闪出白底。
        int surfaceColor = AppSettings.getScreenColor(this);
        container.setBackgroundColor(surfaceColor);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(surfaceColor);
        container.addView(webView);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            container.setOnApplyWindowInsetsListener(WebShellActivity::padForSystemBars);
        }
        setContentView(container);
        container.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // 核销页的摄像头预览由脚本在授权后自行 play()，因此不再要求用户手势。
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 页面脚本由下面的拦截从本机快照读取，不进 WebView 的 HTTP 缓存。
        // 接口和 /media 仍按各自的响应头缓存，避免头像每次切换都重新下载。
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 接口是 http 时必须允许混合内容，接口是 https 时关闭。取值跟构建时的 APP_API_BASE 一致。
        settings.setMixedContentMode(BuildConfig.ALLOW_CLEARTEXT
                ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 深色模式由前端令牌控制。setForceDark 在 targetSdk ≥ 33 已是空操作，
            // 这里关掉 WebView 的算法反色，避免系统把页面再涂一遍。
            settings.setAlgorithmicDarkeningAllowed(false);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (PageOrigin.staysInWebView(uri.toString(), BuildConfig.APP_ORIGIN)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception error) {
                    Log.w(TAG, "无法打开外部链接: " + uri, error);
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!PageOrigin.isAppDocument(url, BuildConfig.APP_ORIGIN)) {
                    return;
                }
                // 页面脚本加载完成后通知前端，前端据此拉取 bootstrap 数据。
                view.evaluateJavascript("window.CalMobileWeb&&window.CalMobileWeb.ready&&"
                        + "window.CalMobileWeb.ready();", null);
                scheduleHotUpdate();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, "web console: " + message.message()
                        + " @" + message.sourceId() + ":" + message.lineNumber());
                return true;
            }

            /**
             * 摄像头只用于展商核销页的扫码取景。
             * <p>
             * 应用层权限由前端先通过 {@code camera.ensurePermission} 申请，用户同意后
             * WebView 的 getUserMedia 请求才会被放行；其它权限仍然一律拒绝。
             */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                final String[] resources = request.getResources();
                boolean videoOnly = resources != null && resources.length > 0;
                if (videoOnly) {
                    for (String resource : resources) {
                        if (!PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            videoOnly = false;
                            break;
                        }
                    }
                }
                final boolean granted = videoOnly && hasCameraPermission();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (granted) {
                            request.grant(resources);
                        } else {
                            request.deny();
                        }
                    }
                });
            }

            /**
             * WebView 里的 {@code <input type="file">} 必须实现这个回调才会弹系统选择器；
             * 不实现时默认返回 false，页面点「从文件安装」不会有任何反应。
             * <p>
             * 结果交给 {@link WebChromeClient.FileChooserParams#parseResult} 解析：多选结果在
             * ClipData 里，用户按返回键取消时它返回 null，正好对应 {@code onReceiveValue(null)}。
             */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                applyAcceptTypes(intent, params.getAcceptTypes());
                int requestCode = nextFileChooserRequestCode();
                fileChooserCallbacks.put(requestCode, callback);
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), requestCode);
                } catch (ActivityNotFoundException error) {
                    // 设备上没有能应答的选择器：必须回一次 null，
                    // 否则页面的 input 一直等结果，下一次点击也挂住。
                    fileChooserCallbacks.remove(requestCode);
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        bridge = new WebAppBridge(this, webView, new Gson());
        webView.addJavascriptInterface(bridge, "CalMobileNative");
        pageFiles = openPageSnapshot();

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.APP_PAGE_URL);
        } else {
            webView.restoreState(savedInstanceState);
            // 覆盖安装后可能恢复成旧的 appassets 文档。那份地址不能调用桥，脚本也不是同源。
            if (!PageOrigin.isAppDocument(webView.getUrl(), BuildConfig.APP_ORIGIN)) {
                webView.loadUrl(BuildConfig.APP_PAGE_URL);
            }
        }
    }

    /** 正式包优先用对得上当前外壳的本机快照。调试包始终用刚打进 APK 的页面。 */
    private File openPageSnapshot() {
        if (BuildConfig.ALLOW_CLEARTEXT) {
            return null;
        }
        return WebSnapshot.activate(new File(getFilesDir(), "web-release"), BuildConfig.VERSION_CODE);
    }

    /** 首屏出来后再拉取新页面，避免和启动数据抢网络。这次进程不重载。 */
    private void scheduleHotUpdate() {
        if (hotUpdateStarted || BuildConfig.ALLOW_CLEARTEXT) {
            return;
        }
        hotUpdateStarted = true;
        final File root = new File(getFilesDir(), "web-release");
        final int versionCode = BuildConfig.VERSION_CODE;
        final String origin = BuildConfig.APP_ORIGIN;
        final String currentId = currentReleaseId();
        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                WebHotUpdate.Result result = WebHotUpdate.fetch(origin, currentId, root, versionCode);
                if (result == WebHotUpdate.Result.FAILED) {
                    Log.w(TAG, "应用页面热更新失败，继续使用当前快照");
                }
            }
        }, "web-hot-update");
        worker.start();
    }

    private String currentReleaseId() {
        String id = WebSnapshot.releaseId(pageFiles);
        if (id != null) {
            return id;
        }
        try {
            InputStream input = getAssets().open("web/release.json");
            try {
                byte[] bytes = WebSnapshot.readAtMost(input, 1024 * 1024);
                WebSnapshot.Manifest manifest = WebSnapshot.parse(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                return manifest == null ? "" : manifest.id;
            } finally {
                input.close();
            }
        } catch (IOException missing) {
            return "";
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    /** 返回键先交给前端历史栈，栈底再退出应用。 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /**
     * 分配一个文件选择器专用的 requestCode。
     *
     * 从 1000 起自增，到桥的区间（6000 起）前绕回起点，并跳过还挂着回调的号：
     * 这两张表绝不能收到同一个 requestCode，否则结果会落到别处的选择器上。
     */
    private int nextFileChooserRequestCode() {
        while (true) {
            int code = nextFileChooserRequestCode;
            nextFileChooserRequestCode = code + 1;
            if (nextFileChooserRequestCode >= BRIDGE_REQUEST_CODE_BASE) {
                nextFileChooserRequestCode = FILE_CHOOSER_REQUEST_BASE;
            }
            if (!fileChooserCallbacks.containsKey(code)) {
                return code;
            }
        }
    }

    /**
     * 把 {@code accept} 属性转成系统选择器的类型：单个 MIME 直接当 type，多个时用第一个当 type、
     * 其余放进 {@code EXTRA_MIME_TYPES}（ACTION_GET_CONTENT 只认一个 type）。
     * <p>
     * {@code accept} 里的扩展名（{@code ".json"}）不一定被 WebView 改写成 MIME，这里只放行含
     * 斜杠的项，一个都没有就退回任意类型（&#42;/&#42;）：宁可让用户自己挑，
     * 也不要传一个没有应用能应答的类型。
     */
    private static void applyAcceptTypes(Intent intent, String[] acceptTypes) {
        List<String> accepted = new ArrayList<>();
        if (acceptTypes != null) {
            for (String type : acceptTypes) {
                if (type != null && type.indexOf('/') > 0) {
                    accepted.add(type.trim());
                }
            }
        }
        if (accepted.isEmpty()) {
            intent.setType("*/*");
            return;
        }
        intent.setType(accepted.get(0));
        if (accepted.size() > 1) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, accepted.toArray(new String[0]));
        }
    }

    /**
     * 文件选择器的结果先在这里消化，剩下的再转发给桥。
     * <p>
     * 表项无论成功、取消还是失败都要移除：留着既泄漏 ValueCallback，
     * 也会让这个 requestCode 对应的下一次选择找不到入口。
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        ValueCallback<Uri[]> fileChooser = fileChooserCallbacks.remove(requestCode);
        if (fileChooser != null) {
            super.onActivityResult(requestCode, resultCode, data);
            // parseResult 在取消（RESULT_CANCELED / data == null）时返回 null，多选从 ClipData 取。
            Uri[] result = resultCode == RESULT_OK && data != null
                    ? WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                    : null;
            fileChooser.onReceiveValue(result);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
        if (bridge != null) {
            bridge.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (bridge != null) {
            bridge.onRequestPermissionsResult(requestCode, permissions, grantResults);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("CalMobileNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ── 本地资源加载 ───────────────────────────────────────────

    /** 应用是否已拿到摄像头权限，供 WebView 的取景请求判断是否放行。 */
    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private static final Map<String, String> MIME_TYPES = new HashMap<>();

    static {
        MIME_TYPES.put("html", "text/html");
        MIME_TYPES.put("css", "text/css");
        MIME_TYPES.put("js", "application/javascript");
        MIME_TYPES.put("mjs", "application/javascript");
        MIME_TYPES.put("wasm", "application/wasm");
        MIME_TYPES.put("json", "application/json");
        MIME_TYPES.put("svg", "image/svg+xml");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("jpg", "image/jpeg");
        MIME_TYPES.put("jpeg", "image/jpeg");
        MIME_TYPES.put("webp", "image/webp");
        MIME_TYPES.put("woff2", "font/woff2");
        MIME_TYPES.put("txt", "text/plain");
        MIME_TYPES.put("md", "text/markdown");
    }

    /**
     * {@code /app/} 从本机快照或包内页面读取。设备媒体仍走 appassets。
     * 其它地址（接口、站内图片）交给 WebView 自己请求。
     */
    private WebResourceResponse serve(WebResourceRequest request) {
        Uri uri = request == null ? null : request.getUrl();
        if (uri == null) {
            return null;
        }
        if ("appassets.androidplatform.net".equals(uri.getHost())) {
            return serveAsset(uri, request.getMethod());
        }
        if (!PageOrigin.staysInWebView(uri.toString(), BuildConfig.APP_ORIGIN)) {
            return null;
        }
        String path = uri.getPath() != null ? uri.getPath() : "";
        String relative = AssetGuard.resolveAppRelativePath(android.net.Uri.decode(path));
        if (relative == null) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                    securityHeaders(), null);
        }
        return serveAppFile(relative);
    }

    /**
     * 把 {@code /assets/web/...} 的请求映射到 APK 内的 asset 文件。
     * 只允许访问 {@code web/} 目录，避免通过 URL 读取其他打包资源。
     */
    private WebResourceResponse serveAsset(Uri uri, String method) {
        if (!"appassets.androidplatform.net".equals(uri.getHost())) {
            return null;
        }
        // 用解码后的路径做前缀判断：uri.getPath() 未解码时，编码的 %2e 会先被
        // AssetGuard 解开再拦截，不会带着编码形式漏过去。
        String path = uri.getPath() != null ? uri.getPath() : "";
        String decoded = android.net.Uri.decode(path);
        if (decoded.startsWith("/media/")) {
            String name = decoded.substring("/media/".length());
            // fetch 跨源时可能先发预检。媒体文件本身是简单 GET，这里仍应答，避免预检被当成失败。
            if ("OPTIONS".equalsIgnoreCase(method)) {
                int status = AssetGuard.isMediaFileAllowed(name) ? 204 : 403;
                String reason = status == 204 ? "No Content" : "Forbidden";
                return new WebResourceResponse("text/plain", "utf-8", status, reason, mediaHeaders(), null);
            }
            return serveMedia(name);
        }
        String assetPath = AssetGuard.resolveAssetPath(decoded);
        if (assetPath == null) {
            if (decoded.startsWith("/assets/")) {
                // 想读 web/ 之外的打包资源或带路径穿越：明确拒绝，而不是放行给系统默认处理。
                return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                        securityHeaders(), null);
            }
            return null;
        }
        try {
            InputStream input = getAssets().open(assetPath);
            String extension = assetPath.contains(".")
                    ? assetPath.substring(assetPath.lastIndexOf('.') + 1).toLowerCase()
                    : "html";
            String mime = MIME_TYPES.containsKey(extension) ? MIME_TYPES.get(extension) : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", 200, "OK",
                    assetHeaders(assetPath, extension), input);
        } catch (IOException missing) {
            Log.w(TAG, "资源不存在: " + assetPath);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    securityHeaders(), null);
        }
    }

    /**
     * 应用页面从这次进程选定的目录读。快照缺文件时不回退到包内另一份，避免混用两个版本。
     * <p>
     * 响应用 {@code no-store}：WebView 的 HTTP 缓存键只有 URL，覆盖安装或热更新后
     * 会把旧的 index.html 配到新脚本上。字节本来就在本机，直接读文件。
     */
    private WebResourceResponse serveAppFile(String relative) {
        try {
            InputStream input = openAppFile(relative);
            if (input == null) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        securityHeaders(), null);
            }
            String extension = relative.contains(".")
                    ? relative.substring(relative.lastIndexOf('.') + 1).toLowerCase()
                    : "html";
            String mime = MIME_TYPES.containsKey(extension) ? MIME_TYPES.get(extension) : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", 200, "OK", securityHeaders(), input);
        } catch (IOException missing) {
            Log.w(TAG, "应用页面不存在: " + relative);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    securityHeaders(), null);
        }
    }

    private InputStream openAppFile(String relative) throws IOException {
        if (pageFiles != null) {
            File file = new File(pageFiles, relative);
            if (!file.isFile() || !WebSnapshot.isInside(pageFiles, file)) {
                return null;
            }
            return new FileInputStream(file);
        }
        return getAssets().open("web/" + relative);
    }

    /**
     * APK 内的静态资源响应头。
     * <p>
     * 脚本、WASM 与样式用 `no-cache`（**可以缓存，但每次都要回来校验**），而不是 `max-age`：
     * 覆盖安装 APK 并不会清掉 `/data/data/<包名>/cache`，WebView 的 HTTP 缓存键又只有 URL，
     * 因此 `max-age=86400` 会出现「新的 index.html 配旧的 js 模块」这种只在升级当天复现的错乱。
     * 这些文件就在 APK 里，回源（重新读 assets）本身很便宜，没必要为省一次读取冒版本不一致的风险。
     * HTML 仍为 `no-store`，每次导航都取最新的外壳。
     */
    private Map<String, String> assetHeaders(String assetPath, String extension) {
        Map<String, String> headers = new HashMap<>();
        boolean revalidated = "js".equals(extension) || "mjs".equals(extension)
                || "wasm".equals(extension) || "css".equals(extension) || "woff2".equals(extension);
        headers.put("Cache-Control", revalidated ? "no-cache" : "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    private Map<String, String> securityHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    /** 设备媒体给页面 fetch 用，要带上页面源，否则跨源读取失败。 */
    private Map<String, String> mediaHeaders() {
        return MediaCors.headers(BuildConfig.APP_ORIGIN);
    }

    /**
     * 读取用户上传的媒体文件。
     * <p>
     * 只允许访问 {@code files/media} 下的单层文件名，路径中带分隔符或 {@code ..} 一律拒绝，
     * 避免通过 URL 读取应用私有目录里的其它文件。
     */
    private WebResourceResponse serveMedia(String name) {
        if (!AssetGuard.isMediaFileAllowed(name)) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                    mediaHeaders(), null);
        }
        File file = new File(mediaDir(this), name);
        if (!file.isFile()) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    mediaHeaders(), null);
        }
        String extension = name.contains(".")
                ? name.substring(name.lastIndexOf('.') + 1).toLowerCase()
                : "bin";
        String mime = MIME_TYPES.containsKey(extension)
                ? MIME_TYPES.get(extension)
                : guessMediaMime(extension);
        try {
            return new WebResourceResponse(mime, "utf-8", 200, "OK", mediaHeaders(),
                    new FileInputStream(file));
        } catch (IOException error) {
            Log.w(TAG, "媒体文件读取失败: " + name, error);
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error",
                    mediaHeaders(), null);
        }
    }

    private static String guessMediaMime(String extension) {
        switch (extension) {
            case "mp4":
            case "m4v":
                return "video/mp4";
            case "webm":
                return "video/webm";
            case "mov":
                return "video/quicktime";
            case "gif":
                return "image/gif";
            case "bmp":
                return "image/bmp";
            default:
                return "application/octet-stream";
        }
    }
}
