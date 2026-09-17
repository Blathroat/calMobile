package com.example.calmobile;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
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
import java.util.HashMap;
import java.util.Map;

/**
 * WebView 前端容器。
 * <p>
 * 页面资源来自 {@code app/src/main/assets/web/}，映射到 {@code https://appassets.androidplatform.net/assets/web/}，
 * 保持标准 Web 安全上下文（便于 fetch 与 ES 模块加载）。所有业务调用统一走 {@link WebAppBridge}。
 */
public class WebShellActivity extends Activity {

    /** 前端资源根地址，页面之间使用相对路径互相导航。 */
    public static final String BASE_URL =
            "https://appassets.androidplatform.net/assets/web/";

    /** 用户上传的图片与视频的虚拟目录：内容存放在应用私有目录，URL 里只出现文件名。 */
    public static final String MEDIA_URL = "https://appassets.androidplatform.net/media/";

    private static final String TAG = "WebShellActivity";

    /** 上传文件的落盘目录（files/media），图片以短 URL 引用，避免把 base64 写进长简介。 */
    public static File mediaDir(Context context) {
        File dir = new File(context.getFilesDir(), "media");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "无法创建媒体目录: " + dir);
        }
        return dir;
    }

    private WebView webView;
    private WebAppBridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppSettings.applyWindowColors(this);

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
        setContentView(container);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // 核销页的摄像头预览由脚本在授权后自行 play()，因此不再要求用户手势。
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 页面运行在 https://appassets.androidplatform.net 上下文里，访问明文后端
        // （演示服务 http://127.0.0.1:4000）会被判定为混合内容。正式后端改用 HTTPS
        // 后应当把这一行改回 MIXED_CONTENT_NEVER_ALLOW。
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 深色模式由前端令牌控制，这里始终关掉系统强制反色。
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(BASE_URL)) {
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
                // 页面脚本加载完成后通知前端，前端据此拉取 bootstrap 数据。
                view.evaluateJavascript("window.CalMobileWeb&&window.CalMobileWeb.ready&&"
                        + "window.CalMobileWeb.ready();", null);
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
        });

        bridge = new WebAppBridge(this, webView, new Gson());
        webView.addJavascriptInterface(bridge, "CalMobileNative");

        if (savedInstanceState == null) {
            webView.loadUrl(BASE_URL + "index.html");
        } else {
            webView.restoreState(savedInstanceState);
            if (webView.getUrl() == null) {
                webView.loadUrl(BASE_URL + "index.html");
            }
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
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
     * 把 {@code /assets/web/...} 的请求映射到 APK 内的 asset 文件。
     * 只允许访问 {@code web/} 目录，避免通过 URL 读取其他打包资源。
     */
    private WebResourceResponse serveAsset(Uri uri) {
        if (!"appassets.androidplatform.net".equals(uri.getHost())) {
            return null;
        }
        String path = uri.getPath();
        if (path == null) {
            return null;
        }
        if (path.startsWith("/media/")) {
            return serveMedia(path.substring("/media/".length()));
        }
        if (!path.startsWith("/assets/web/")) {
            return null;
        }
        String assetPath = path.substring("/assets/".length());
        if (assetPath.contains("..")) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                    securityHeaders(), null);
        }
        try {
            InputStream input = getAssets().open(assetPath);
            String extension = assetPath.contains(".")
                    ? assetPath.substring(assetPath.lastIndexOf('.') + 1).toLowerCase()
                    : "html";
            String mime = MIME_TYPES.containsKey(extension) ? MIME_TYPES.get(extension) : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", 200, "OK", securityHeaders(), input);
        } catch (IOException missing) {
            Log.w(TAG, "资源不存在: " + assetPath);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    securityHeaders(), null);
        }
    }

    private Map<String, String> securityHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    /**
     * 读取用户上传的媒体文件。
     * <p>
     * 只允许访问 {@code files/media} 下的单层文件名，路径中带分隔符或 {@code ..} 一律拒绝，
     * 避免通过 URL 读取应用私有目录里的其它文件。
     */
    private WebResourceResponse serveMedia(String name) {
        if (name.isEmpty() || name.contains("/") || name.contains("\\") || name.contains("..")) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                    securityHeaders(), null);
        }
        File file = new File(mediaDir(this), name);
        if (!file.isFile()) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    securityHeaders(), null);
        }
        String extension = name.contains(".")
                ? name.substring(name.lastIndexOf('.') + 1).toLowerCase()
                : "bin";
        String mime = MIME_TYPES.containsKey(extension)
                ? MIME_TYPES.get(extension)
                : guessMediaMime(extension);
        try {
            return new WebResourceResponse(mime, "utf-8", 200, "OK", securityHeaders(),
                    new FileInputStream(file));
        } catch (IOException error) {
            Log.w(TAG, "媒体文件读取失败: " + name, error);
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error",
                    securityHeaders(), null);
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
