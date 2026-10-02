package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 资源路径守卫：钉住「哪些 URL 能读到 APK 内资源 / 私有媒体文件」的判定。
 * 这里失败意味着 WebView 可能通过 URL 读到不该读的文件，属于安全回归。
 */
public class AssetGuardTest {

    @Test
    public void 资源路径只放行web目录() {
        assertEquals("web/index.html", AssetGuard.resolveAssetPath("/assets/web/index.html"));
        assertEquals("web/assets/index.js", AssetGuard.resolveAssetPath("/assets/web/assets/index.js"));
        assertEquals("web/assets/qr-reader-abc123.js",
                AssetGuard.resolveAssetPath("/assets/web/assets/qr-reader-abc123.js"));
        assertEquals("web/assets/zxing_reader-abc123.wasm",
                AssetGuard.resolveAssetPath("/assets/web/assets/zxing_reader-abc123.wasm"));
        assertNull(AssetGuard.resolveAssetPath("/assets/other/x.html"));
        assertNull(AssetGuard.resolveAssetPath("/assets/web"));
        assertNull(AssetGuard.resolveAssetPath("/assets/web2/x.html"));
        assertNull(AssetGuard.resolveAssetPath(null));
    }

    @Test
    public void 路径穿越一律拒绝() {
        assertNull(AssetGuard.resolveAssetPath("/assets/web/../../res/values/strings.xml"));
        assertNull(AssetGuard.resolveAssetPath("/assets/web/..%2f..%2fres/x"));
        // %2e 编码的点也要被解开后再判
        assertNull(AssetGuard.resolveAssetPath("/assets/web/%2e%2e/%2e%2e/res/x"));
        assertNull(AssetGuard.resolveAssetPath("/assets/web/sub/../.."));
        assertNull(AssetGuard.resolveAssetPath("/assets/web/assets/%2e%2e/%2e%2e/decoder.wasm"));
        assertNull(AssetGuard.resolveAssetPath("/assets/web/assets/..%5c..%5cworker.js"));
    }

    @Test
    public void 媒体文件名只放单层() {
        assertTrue(AssetGuard.isMediaFileAllowed("cover-abc123.jpg"));
        assertTrue(AssetGuard.isMediaFileAllowed("name.with.dots.png"));
        assertFalse(AssetGuard.isMediaFileAllowed(""));
        assertFalse(AssetGuard.isMediaFileAllowed(null));
        assertFalse(AssetGuard.isMediaFileAllowed("../secret.txt"));
        assertFalse(AssetGuard.isMediaFileAllowed("sub/dir/file.jpg"));
        assertFalse(AssetGuard.isMediaFileAllowed("back\\slash.txt"));
        // 编码形式的分隔符与穿越同样拒绝
        assertFalse(AssetGuard.isMediaFileAllowed("%2e%2e/secret"));
        assertFalse(AssetGuard.isMediaFileAllowed("a%2fb.jpg"));
        assertFalse(AssetGuard.isMediaFileAllowed("a%5cb.jpg"));
    }
}
