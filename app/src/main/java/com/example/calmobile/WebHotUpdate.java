package com.example.calmobile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * 后台拉取 {@code /app/release.json}，核对后把新页面放到下次冷启动才启用的目录。
 * <p>
 * 不在这次进程里换页面，避免使用中重载。失败只留下原来的快照。
 * <p>
 * 清单里带 {@code skipVerify} 的文件（只有 HTML）跳过哈希核对：反向代理会在页面里插脚本
 * （Cloudflare 的 JavaScript 检测），构建时的哈希和线上字节对不上，但页面仍然可用。
 */
final class WebHotUpdate {

    enum Result {
        UNCHANGED,
        UPDATED,
        FAILED
    }

    private static final int MAX_MANIFEST = 1024 * 1024;
    private static final int MAX_FILE = 32 * 1024 * 1024;
    private static final int MAX_TOTAL = 64 * 1024 * 1024;

    private WebHotUpdate() {
    }

    static Result fetch(String origin, String currentId, File root, int versionCode) {
        if (origin == null || origin.isEmpty() || root == null || versionCode <= 0) {
            return Result.FAILED;
        }
        String base = origin.endsWith("/") ? origin.substring(0, origin.length() - 1) : origin;
        File incoming = new File(root, "incoming");
        WebSnapshot.deleteRecursively(incoming);
        if (!incoming.mkdirs() && !incoming.isDirectory()) {
            return Result.FAILED;
        }
        try {
            byte[] manifestBytes = getBytes(base + "/app/release.json");
            String json = new String(manifestBytes, StandardCharsets.UTF_8);
            WebSnapshot.Manifest manifest = WebSnapshot.parse(json);
            if (manifest == null) {
                throw new IOException("清单不合法");
            }
            if (manifest.id.equals(currentId)) {
                WebSnapshot.deleteRecursively(incoming);
                return Result.UNCHANGED;
            }
            long total = 0;
            for (WebSnapshot.Entry entry : manifest.files) {
                File target = new File(incoming, entry.path);
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    throw new IOException("无法创建目录");
                }
                if (!WebSnapshot.isInside(incoming, target)) {
                    throw new IOException("路径越界");
                }
                total += download(base + "/app/" + entry.path, target, entry);
                if (total > MAX_TOTAL) {
                    throw new IOException("页面包过大");
                }
            }
            writeUtf8(new File(incoming, "release.json"), json);
            writeUtf8(new File(incoming, "version.txt"), versionCode + "\n");
            if (!WebSnapshot.publishIncoming(root)) {
                throw new IOException("无法发布快照");
            }
            return Result.UPDATED;
        } catch (IOException | RuntimeException ignored) {
            WebSnapshot.deleteRecursively(incoming);
            return Result.FAILED;
        }
    }

    private static byte[] getBytes(String url) throws IOException {
        HttpURLConnection conn = open(url);
        try {
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("状态 " + conn.getResponseCode());
            }
            try (InputStream in = conn.getInputStream()) {
                return WebSnapshot.readAtMost(in, MAX_MANIFEST);
            }
        } finally {
            conn.disconnect();
        }
    }

    private static void writeUtf8(File file, String text) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * 下载一个文件。
     * <p>
     * 普通文件逐个核对 sha256；带 {@code skipVerify} 的只做完整性检查（见
     * {@link #checkUnverified(File, String, long)}），因为反向代理会改写 HTML 的内容。
     */
    private static long download(String url, File target, WebSnapshot.Entry entry) throws IOException {
        HttpURLConnection conn = open(url);
        try {
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("状态 " + conn.getResponseCode());
            }
            MessageDigest digest;
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (NoSuchAlgorithmException error) {
                throw new IllegalStateException(error);
            }
            long total = 0;
            try (InputStream in = conn.getInputStream();
                 DigestOutputStream out = new DigestOutputStream(new FileOutputStream(target), digest)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) >= 0) {
                    total += n;
                    if (total > MAX_FILE) {
                        throw new IOException("文件过大");
                    }
                    out.write(buf, 0, n);
                }
            }
            String actual = WebSnapshot.hex(digest.digest());
            if (entry.skipVerify) {
                return checkUnverified(target, entry.path, total);
            }
            if (!actual.equals(entry.sha256)) {
                throw new IOException("校验失败");
            }
            return total;
        } finally {
            conn.disconnect();
        }
    }

    /** 不核对哈希时的完整性检查：非空；HTML 还要有正常结尾，挡住被截断的页面。 */
    private static long checkUnverified(File target, String path, long total) throws IOException {
        if (total <= 0) {
            throw new IOException("文件为空");
        }
        if (path.toLowerCase(Locale.ROOT).endsWith(".html") && !hasHtmlEnd(target)) {
            throw new IOException("页面不完整");
        }
        return total;
    }

    /** 读文件末尾一小段，看 HTML 是不是正常收尾（{@code </html>}）。 */
    private static boolean hasHtmlEnd(File file) throws IOException {
        long length = file.length();
        int keep = (int) Math.min(length, 4096);
        byte[] tail = new byte[keep];
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            input.seek(length - keep);
            input.readFully(tail);
        }
        return new String(tail, StandardCharsets.UTF_8).toLowerCase(Locale.ROOT).contains("</html>");
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setUseCaches(false);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(20_000);
        conn.setRequestProperty("Cache-Control", "no-cache");
        return conn;
    }
}
