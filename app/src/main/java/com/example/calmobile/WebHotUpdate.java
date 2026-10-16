package com.example.calmobile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 后台拉取 {@code /app/release.json}，核对后把新页面放到下次冷启动才启用的目录。
 * <p>
 * 不在这次进程里换页面，避免使用中重载。失败只留下原来的快照。
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
                total += download(base + "/app/" + entry.path, target, entry.sha256);
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

    private static long download(String url, File target, String expectedSha256) throws IOException {
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
            if (!actual.equals(expectedSha256)) {
                throw new IOException("校验失败");
            }
            return total;
        } finally {
            conn.disconnect();
        }
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
