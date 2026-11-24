package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

import org.junit.Test;

/** 热更新核对哈希，相同清单不替换正在使用的页面。 */
public class WebHotUpdateTest {

    /** 新清单下载到待用目录。哈希对不上时不替换已有快照。 */
    @Test
    public void downloadsPendingReleaseAndKeepsItWhenHashMismatches() throws Exception {
        byte[] html = "<!doctype html>".getBytes(StandardCharsets.UTF_8);
        String hash = WebSnapshot.sha256(html);
        String id = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
        String manifest = "{\"id\":\"" + id + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash + "\"}]}";
        LocalHttp server = new LocalHttp(manifest.getBytes(StandardCharsets.UTF_8), html);
        File root = tempDir("calmobile-hot");
        try {
            assertEquals(WebHotUpdate.Result.UPDATED, WebHotUpdate.fetch(server.origin(), "", root, 3));
            File pending = new File(root, "pending");
            assertTrue(new File(pending, "index.html").isFile());
            assertEquals(id, WebSnapshot.releaseId(pending));

            assertEquals(WebHotUpdate.Result.UNCHANGED, WebHotUpdate.fetch(server.origin(), id, root, 3));

            String other = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
            String badManifest = "{\"id\":\"" + other + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash + "\"}]}";
            LocalHttp bad = new LocalHttp(badManifest.getBytes(StandardCharsets.UTF_8), "nope".getBytes(StandardCharsets.UTF_8));
            try {
                assertEquals(WebHotUpdate.Result.FAILED, WebHotUpdate.fetch(bad.origin(), id, root, 3));
                assertEquals(id, WebSnapshot.releaseId(new File(root, "pending")));
                assertNotNull(WebSnapshot.activate(root, 3));
            } finally {
                bad.close();
            }
        } finally {
            server.close();
            WebSnapshot.deleteRecursively(root);
        }
    }

    /**
     * 反向代理改写过的 HTML：清单的 sha256 对不上，但带 skipVerify 时仍然接受。
     * Cloudflare 的 JavaScript 检测会往页面里插脚本，正是这个场景。
     */
    @Test
    public void acceptsProxyTransformedHtmlWhenVerificationIsSkipped() throws Exception {
        byte[] built = "<!doctype html><p>build</p></html>".getBytes(StandardCharsets.UTF_8);
        byte[] served = "<!doctype html><script>cf</script><p>build</p></html>".getBytes(StandardCharsets.UTF_8);
        String hash = WebSnapshot.sha256(built);
        String id = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        String manifest = "{\"id\":\"" + id + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash
                + "\",\"skipVerify\":true}]}";
        LocalHttp server = new LocalHttp(manifest.getBytes(StandardCharsets.UTF_8), served);
        File root = tempDir("calmobile-hot-skip");
        try {
            assertEquals(WebHotUpdate.Result.UPDATED, WebHotUpdate.fetch(server.origin(), "", root, 3));
            File pending = new File(root, "pending");
            assertEquals(id, WebSnapshot.releaseId(pending));
            assertEquals(served.length, new File(pending, "index.html").length());
        } finally {
            server.close();
            WebSnapshot.deleteRecursively(root);
        }
    }

    /** 跳过哈希核对也挡得住明显损坏的下载：没有正常结尾的 HTML 仍然判失败。 */
    @Test
    public void rejectsTruncatedHtmlWhenVerificationIsSkipped() throws Exception {
        byte[] built = "<!doctype html><p>build</p></html>".getBytes(StandardCharsets.UTF_8);
        byte[] truncated = "<!doctype html><p>trunc".getBytes(StandardCharsets.UTF_8);
        String hash = WebSnapshot.sha256(built);
        String id = "9999999999999999999999999999999999999999999999999999999999999999";
        String manifest = "{\"id\":\"" + id + "\",\"files\":[{\"path\":\"index.html\",\"sha256\":\"" + hash
                + "\",\"skipVerify\":true}]}";
        LocalHttp server = new LocalHttp(manifest.getBytes(StandardCharsets.UTF_8), truncated);
        File root = tempDir("calmobile-hot-skip-broken");
        try {
            assertEquals(WebHotUpdate.Result.FAILED, WebHotUpdate.fetch(server.origin(), "", root, 3));
            assertNull(WebSnapshot.releaseId(new File(root, "pending")));
        } finally {
            server.close();
            WebSnapshot.deleteRecursively(root);
        }
    }

    private static File tempDir(String name) {
        File dir = new File(System.getProperty("java.io.tmpdir"), name + "-" + System.nanoTime());
        if (!dir.mkdirs() && !dir.isDirectory()) {
            throw new IllegalStateException("无法创建临时目录");
        }
        return dir;
    }

    /** 只应答清单和 index.html 的本机 HTTP。单测编译看不到 com.sun.net.httpserver。 */
    private static final class LocalHttp {
        private final ServerSocket socket;
        private final Thread thread;
        private volatile byte[] release;
        private volatile byte[] index;
        private volatile boolean stop;

        LocalHttp(byte[] release, byte[] index) throws IOException {
            this.release = release;
            this.index = index;
            this.socket = new ServerSocket();
            this.socket.bind(new InetSocketAddress("127.0.0.1", 0));
            this.thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    serve();
                }
            }, "test-http");
            this.thread.setDaemon(true);
            this.thread.start();
        }

        String origin() {
            return "http://127.0.0.1:" + socket.getLocalPort();
        }

        void close() throws IOException {
            stop = true;
            socket.close();
        }

        private void serve() {
            while (!stop) {
                try {
                    Socket client = socket.accept();
                    handle(client);
                } catch (IOException ignored) {
                    if (stop) {
                        return;
                    }
                }
            }
        }

        private void handle(Socket client) throws IOException {
            try {
                client.setSoTimeout(5000);
                String headers = readHeaders(client.getInputStream());
                byte[] body;
                int status = 200;
                if (headers.contains(" /app/release.json ")) {
                    body = release;
                } else if (headers.contains(" /app/index.html ")) {
                    body = index;
                } else {
                    body = new byte[0];
                    status = 404;
                }
                String statusLine = status == 200 ? "HTTP/1.1 200 OK" : "HTTP/1.1 404 Not Found";
                byte[] head = (statusLine + "\r\nContent-Length: " + body.length
                        + "\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n")
                        .getBytes(StandardCharsets.US_ASCII);
                OutputStream out = client.getOutputStream();
                out.write(head);
                out.write(body);
                out.flush();
            } finally {
                client.close();
            }
        }

        private static String readHeaders(InputStream in) throws IOException {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            int matched = 0;
            while (matched < 4 && buf.size() < 8192) {
                int value = in.read();
                if (value < 0) {
                    break;
                }
                buf.write(value);
                if (value == "\r\n\r\n".charAt(matched)) {
                    matched++;
                } else {
                    matched = value == '\r' ? 1 : 0;
                }
            }
            return buf.toString("ISO-8859-1");
        }
    }
}
