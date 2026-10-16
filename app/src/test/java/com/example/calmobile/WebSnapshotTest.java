package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

/** 快照只在下次启动替换，并且拒绝坏路径。 */
public class WebSnapshotTest {

    /** 清单拒绝路径穿越，也不接受 release.json 自身。 */
    @Test
    public void rejectsTraversalAndTheManifestFile() {
        assertNull(WebSnapshot.parse("{\"id\":\"ab\",\"files\":[]}"));
        String id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assertNull(WebSnapshot.parse("{\"id\":\"" + id + "\",\"files\":[{\"path\":\"../x.js\",\"sha256\":\"" + hash + "\"}]}"));
        assertNull(WebSnapshot.parse("{\"id\":\"" + id + "\",\"files\":[{\"path\":\"release.json\",\"sha256\":\"" + hash + "\"}]}"));
        WebSnapshot.Manifest manifest = WebSnapshot.parse(
                "{\"id\":\"" + id + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash + "\"}]}");
        assertNotNull(manifest);
        assertEquals("index.html", manifest.files.get(0).path);
    }

    /** 待用快照要等下次启动才换上，外壳 versionCode 不一致就不用。 */
    @Test
    public void promotesPendingSnapshotOnlyForMatchingVersion() throws Exception {
        File root = tempDir("calmobile-snapshot");
        try {
            File incoming = new File(root, "incoming");
            assertTrue(incoming.mkdirs());
            writeUtf8(new File(incoming, "index.html"), "<html></html>");
            writeUtf8(new File(incoming, "release.json"), manifestFor(new File(incoming, "index.html")));
            writeUtf8(new File(incoming, "version.txt"), "7\n");
            assertTrue(WebSnapshot.publishIncoming(root));
            assertNull(WebSnapshot.activate(root, 8));
            File current = WebSnapshot.activate(root, 7);
            assertNotNull(current);
            assertEquals("7", readUtf8(new File(current, "version.txt")).trim());
            assertFalse(new File(root, "pending").exists());
        } finally {
            WebSnapshot.deleteRecursively(root);
        }
    }

    private static String manifestFor(File index) throws Exception {
        String hash = WebSnapshot.sha256(readBytes(index));
        String id = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        return "{\"id\":\"" + id + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash + "\"}]}";
    }

    private static File tempDir(String name) {
        File dir = new File(System.getProperty("java.io.tmpdir"), name + "-" + System.nanoTime());
        if (!dir.mkdirs() && !dir.isDirectory()) {
            throw new IllegalStateException("无法创建临时目录");
        }
        return dir;
    }

    private static void writeUtf8(File file, String text) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String readUtf8(File file) throws IOException {
        return new String(readBytes(file), StandardCharsets.UTF_8);
    }

    private static byte[] readBytes(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            return WebSnapshot.readAtMost(in, 1024 * 1024);
        }
    }
}
