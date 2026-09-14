package com.example.calmobile;

import android.annotation.SuppressLint;
import android.app.Activity;
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

    private static final String TAG = "WebShellActivity";

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
        container.setBackgroundColor(0xFFFFFFFF);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFFFFFFFF);
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
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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

            /** 页面不申请摄像头/麦克风，统一拒绝并把结果交回前端。 */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.deny();
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
        if (path == null || !path.startsWith("/assets/web/")) {
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
}
