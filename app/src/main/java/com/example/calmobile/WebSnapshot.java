package com.example.calmobile;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 应用页面的本机快照。
 * <p>
 * {@code current} 是这次进程正在读的目录，热更新写到 {@code incoming}，核对后换成 {@code pending}。
 * 下次冷启动才把 {@code pending} 换成 {@code current}，使用中的页面不会被换掉。
 * {@code version.txt} 记着打这份快照时的 {@code versionCode}。外壳升级后旧快照作废，先用包内页面。
 */
final class WebSnapshot {

    static final class Entry {
        final String path;
        final String sha256;

        Entry(String path, String sha256) {
            this.path = path;
            this.sha256 = sha256;
        }
    }

    static final class Manifest {
        final String id;
        final List<Entry> files;

        Manifest(String id, List<Entry> files) {
            this.id = id;
            this.files = files;
        }
    }

    private WebSnapshot() {
    }

    /** 解析热更新清单。路径不合法、哈希不是 64 位十六进制或体积过大时返回 null。 */
    static Manifest parse(String json) {
        if (json == null || json.length() > 1_000_000) {
            return null;
        }
        try {
            JsonElement element = JsonParser.parseString(json);
            if (!element.isJsonObject()) {
                return null;
            }
            JsonObject root = element.getAsJsonObject();
            String id = text(root.get("id"));
            if (!isSha256(id)) {
                return null;
            }
            JsonElement filesElement = root.get("files");
            if (filesElement == null || !filesElement.isJsonArray()) {
                return null;
            }
            JsonArray files = filesElement.getAsJsonArray();
            if (files.size() > 200) {
                return null;
            }
            List<Entry> entries = new ArrayList<>();
            for (JsonElement item : files) {
                if (!item.isJsonObject()) {
                    return null;
                }
                JsonObject file = item.getAsJsonObject();
                String path = text(file.get("path"));
                String sha256 = text(file.get("sha256"));
                if (!isRelativeFile(path) || !isSha256(sha256)) {
                    return null;
                }
                entries.add(new Entry(path, sha256.toLowerCase(Locale.ROOT)));
            }
            if (entries.isEmpty()) {
                return null;
            }
            return new Manifest(id.toLowerCase(Locale.ROOT), entries);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    static String sha256(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            return hex(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    /** 待用快照对得上当前外壳时换上来。换不上就继续用已经在用的那份。都没有则返回 null。 */
    static File activate(File root, int versionCode) {
        File pending = new File(root, "pending");
        File current = new File(root, "current");
        if (usable(pending, versionCode)) {
            File backup = new File(root, "current.bak");
            deleteRecursively(backup);
            if (current.exists() && !current.renameTo(backup)) {
                return usable(current, versionCode) ? current : null;
            }
            if (!pending.renameTo(current)) {
                if (backup.exists()) {
                    backup.renameTo(current);
                }
                return usable(current, versionCode) ? current : null;
            }
            deleteRecursively(backup);
        }
        return usable(current, versionCode) ? current : null;
    }

    /** 把核对过的 {@code incoming} 换成下次启动要启用的 {@code pending}。 */
    static boolean publishIncoming(File root) {
        File incoming = new File(root, "incoming");
        File pending = new File(root, "pending");
        File backup = new File(root, "pending.bak");
        deleteRecursively(backup);
        if (pending.exists() && !pending.renameTo(backup)) {
            return false;
        }
        if (!incoming.renameTo(pending)) {
            if (backup.exists()) {
                backup.renameTo(pending);
            }
            return false;
        }
        deleteRecursively(backup);
        return true;
    }

    static String releaseId(File dir) {
        if (dir == null) {
            return null;
        }
        Manifest manifest = parse(readSmall(new File(dir, "release.json")));
        return manifest == null ? null : manifest.id;
    }

    static boolean isInside(File root, File file) {
        try {
            String base = root.getCanonicalPath();
            String target = file.getCanonicalPath();
            String prefix = base.endsWith(File.separator) ? base : base + File.separator;
            return target.equals(base) || target.startsWith(prefix);
        } catch (IOException ignored) {
            return false;
        }
    }

    static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        if (!file.delete() && file.exists()) {
            file.deleteOnExit();
        }
    }

    private static boolean usable(File dir, int versionCode) {
        if (dir == null || !dir.isDirectory()) {
            return false;
        }
        String version = readSmall(new File(dir, "version.txt")).trim();
        if (!String.valueOf(versionCode).equals(version)) {
            return false;
        }
        Manifest manifest = parse(readSmall(new File(dir, "release.json")));
        if (manifest == null) {
            return false;
        }
        for (Entry entry : manifest.files) {
            File file = new File(dir, entry.path);
            if (!file.isFile() || !isInside(dir, file)) {
                return false;
            }
        }
        File index = new File(dir, "index.html");
        return index.isFile() && isInside(dir, index);
    }

    static boolean isRelativeFile(String path) {
        if (path == null || path.isEmpty() || path.length() > 240) {
            return false;
        }
        if ("release.json".equals(path) || "version.txt".equals(path)) {
            return false;
        }
        if (path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0 || path.startsWith("/")) {
            return false;
        }
        for (int i = 0; i < path.length(); i++) {
            char ch = path.charAt(i);
            boolean ok = (ch >= 'a' && ch <= 'z')
                    || (ch >= 'A' && ch <= 'Z')
                    || (ch >= '0' && ch <= '9')
                    || ch == '.' || ch == '_' || ch == '-' || ch == '/';
            if (!ok) {
                return false;
            }
        }
        String[] parts = path.split("/", -1);
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                return false;
            }
        }
        return true;
    }

    private static boolean isSha256(String value) {
        if (value == null || value.length() != 64) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            boolean hex = (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
            if (!hex) {
                return false;
            }
        }
        return true;
    }

    private static String text(JsonElement element) {
        if (element == null || element.isJsonNull() || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
            return "";
        }
        return element.getAsString();
    }

    private static String readSmall(File file) {
        if (file == null || !file.isFile() || file.length() > 1_000_000 || file.length() > Integer.MAX_VALUE) {
            return "";
        }
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = readAtMost(input, (int) file.length());
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            return "";
        }
    }

    static byte[] readAtMost(java.io.InputStream input, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = input.read(buf)) >= 0) {
            total += n;
            if (total > max) {
                throw new IOException("过大");
            }
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            out.append(Character.forDigit((value >> 4) & 0xf, 16));
            out.append(Character.forDigit(value & 0xf, 16));
        }
        return out.toString();
    }
}
