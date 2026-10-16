package com.example.calmobile;

/**
 * WebView 资源路径守卫（纯函数，便于单元测试）。
 * <p>
 * {@link WebShellActivity} 把 {@code https://appassets.androidplatform.net/...} 映射到
 * APK 内 assets 与私有媒体目录，这里的两个判定是所有「能不能读」的唯一入口。
 */
final class AssetGuard {

    private AssetGuard() {
    }

    /**
     * 把 {@code /assets/web/...} 归一化成 assets 相对路径；不允许时返回 null。
     * <p>
     * 拦截点有两个：越出 {@code /assets/web/} 前缀（否则 {@code /assets/other/x} 也能
     * 读到打包资源），以及归一化后出现 {@code ..}（路径穿越）。WebView 传入的
     * {@link android.net.Uri#getPath()} 已经做过一次百分号解码，所以这里见到的是
     * 解码后的文本，编码形式的 {@code .} 会在归一化里现形。
     */
    static String resolveAssetPath(String rawPath) {
        if (rawPath == null || !rawPath.startsWith("/assets/web/")) {
            return null;
        }
        // 百分号解码一遍兜底：即便上游没解码，编码的 %2e 也会在这里现形后被拦。
        String path = percentDecode(rawPath.substring("/assets/".length()));
        if (path.isEmpty() || path.contains("..")) {
            return null;
        }
        return path;
    }

    /**
     * 把 {@code /app/...} 归一化成页面快照里的相对路径。{@code /app} 与 {@code /app/} 是入口。
     * 越出这个前缀或出现 {@code ..} 时返回 null。
     */
    static String resolveAppRelativePath(String rawPath) {
        if (rawPath == null) {
            return null;
        }
        String decoded = percentDecode(rawPath);
        if (decoded.indexOf('\\') >= 0 || decoded.indexOf('\0') >= 0) {
            return null;
        }
        if ("/app".equals(decoded)) {
            return "index.html";
        }
        if (!decoded.startsWith("/app/")) {
            return null;
        }
        String rest = decoded.substring("/app/".length());
        if (rest.isEmpty() || "index.html".equals(rest)) {
            return "index.html";
        }
        String[] parts = rest.split("/", -1);
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                return null;
            }
        }
        return rest;
    }

    /**
     * 媒体短 URL 的文件名：只允许单层文件名，分隔符与 {@code ..} 一律拒绝，
     * 避免通过 URL 读到应用私有目录里的其它文件。
     */
    static boolean isMediaFileAllowed(String name) {
        if (name == null) {
            return false;
        }
        String decoded = percentDecode(name);
        return !decoded.isEmpty()
                && !decoded.contains("/")
                && !decoded.contains("\\")
                && !decoded.contains("..");
    }

    /** 最小百分号解码：只展开 {@code %} 后跟两位十六进制的情况，其余原样保留。 */
    private static String percentDecode(String value) {
        if (value.indexOf('%') < 0) {
            return value;
        }
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            if (ch == '%' && i + 2 < value.length()) {
                int hi = Character.digit(value.charAt(i + 1), 16);
                int lo = Character.digit(value.charAt(i + 2), 16);
                if (hi >= 0 && lo >= 0) {
                    out.append((char) ((hi << 4) + lo));
                    i += 2;
                    continue;
                }
            }
            out.append(ch);
        }
        return out.toString();
    }
}
