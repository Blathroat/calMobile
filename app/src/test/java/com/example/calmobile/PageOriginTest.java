package com.example.calmobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 原生桥只对应用页面开放。 */
public class PageOriginTest {

    /** 应用文档可以调用桥。地址片段不参与判断。 */
    @Test
    public void allowsBridgeOnAppDocument() {
        assertTrue(PageOrigin.isAppDocument(
                "https://app.example.com/app/index.html#/home",
                "https://app.example.com"));
        assertTrue(PageOrigin.isAppDocument(
                "http://127.0.0.1:3000/app/",
                "http://127.0.0.1:3000"));
    }

    /** 报名站、其它主机和协议不一致都不能调用桥。 */
    @Test
    public void rejectsJoinSiteAndForeignOrigins() {
        assertFalse(PageOrigin.isAppDocument(
                "https://app.example.com/e/exh-1",
                "https://app.example.com"));
        assertFalse(PageOrigin.isAppDocument(
                "https://evil.example/app/index.html",
                "https://app.example.com"));
        assertFalse(PageOrigin.isAppDocument(
                "http://app.example.com/app/index.html",
                "https://app.example.com"));
        assertFalse(PageOrigin.isAppDocument(null, "https://app.example.com"));
    }

    /** 只有 /app/ 下的地址留在 WebView，媒体仍走网络。 */
    @Test
    public void keepsOnlyAppPathsInWebView() {
        assertTrue(PageOrigin.staysInWebView(
                "https://app.example.com/app/assets/index-abc.js",
                "https://app.example.com"));
        assertFalse(PageOrigin.staysInWebView(
                "https://app.example.com/media/a.jpg",
                "https://app.example.com"));
    }
}
