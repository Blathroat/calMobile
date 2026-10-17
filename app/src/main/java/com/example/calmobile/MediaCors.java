package com.example.calmobile;

import java.util.HashMap;
import java.util.Map;

/**
 * 设备媒体响应头。
 * <p>
 * 页面文档在接口源的 {@code /app/index.html}，选中的文件在
 * {@code https://appassets.androidplatform.net/media/}。封面和简介要先 {@code fetch}
 * 这份地址再上传，跨源读取必须带上页面源，否则浏览器报 Failed to fetch。
 */
final class MediaCors {

    private MediaCors() {
    }

    /** @param pageOrigin 页面文档的源，例如 {@code https://example.com}，不要带路径。 */
    static Map<String, String> headers(String pageOrigin) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        String origin = pageOrigin == null ? "" : pageOrigin.trim();
        headers.put("Access-Control-Allow-Origin", origin.isEmpty() ? "*" : origin);
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Vary", "Origin");
        return headers;
    }
}
