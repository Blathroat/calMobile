package com.example.calmobile;

import java.net.URI;

/**
 * 应用页面允许停留的文档地址。
 * <p>
 * 只有 {@code <源>/app/index.html}（以及不带文件名的 {@code /app/}）能调用原生桥。
 * 同站其它路径交给系统浏览器，避免报名站页面摸到设备能力。
 */
final class PageOrigin {

    private PageOrigin() {
    }

    /** 当前文档是不是应用页面。片段（{@code #/home}）不参与判断。 */
    static boolean isAppDocument(String url, String origin) {
        URI page = parse(url);
        URI expected = parse(origin);
        if (!sameOrigin(page, expected) || page == null) {
            return false;
        }
        String path = page.getPath() == null ? "" : page.getPath();
        return "/app".equals(path) || "/app/".equals(path) || "/app/index.html".equals(path);
    }

    /** 主框架导航是否仍留在应用页面目录里。 */
    static boolean staysInWebView(String url, String origin) {
        URI page = parse(url);
        URI expected = parse(origin);
        if (!sameOrigin(page, expected) || page == null) {
            return false;
        }
        String path = page.getPath() == null ? "" : page.getPath();
        return "/app".equals(path) || path.startsWith("/app/");
    }

    private static boolean sameOrigin(URI page, URI expected) {
        if (page == null || expected == null) {
            return false;
        }
        if (page.getScheme() == null || expected.getScheme() == null || page.getHost() == null || expected.getHost() == null) {
            return false;
        }
        if (page.getRawUserInfo() != null || expected.getRawUserInfo() != null) {
            return false;
        }
        return page.getScheme().equalsIgnoreCase(expected.getScheme())
                && page.getHost().equalsIgnoreCase(expected.getHost())
                && port(page) == port(expected);
    }

    private static int port(URI uri) {
        if (uri.getPort() != -1) {
            return uri.getPort();
        }
        if ("https".equalsIgnoreCase(uri.getScheme())) {
            return 443;
        }
        if ("http".equalsIgnoreCase(uri.getScheme())) {
            return 80;
        }
        return -1;
    }

    private static URI parse(String value) {
        if (value == null || value.isEmpty()) {
            return null;
        }
        try {
            return URI.create(value);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
