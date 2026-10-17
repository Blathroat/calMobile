package com.example.calmobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

/**
 * 图片 data URL 解析与相册命名。
 *
 * 写相册（MediaStore）与弹系统「另存为」都要 Android Context，普通 JUnit 测不了；
 * 这里钉住纯 Java 的那部分：什么算合法 dataUrl、认得出哪些格式、缺省叫什么名字。
 * 它们决定了保存动作是直接失败，还是真的把字节写下去。
 */
public class MediaActionsTest {

    /** 合法 dataUrl 解析成 mime 与 base64 两段，mime 统一小写。 */
    @Test
    public void parsesImageDataUrl() {
        assertArrayEquals(new String[] { "image/png", "iVBORw0KGgo=" },
                MediaActions.imageDataUrlParts("data:image/png;base64,iVBORw0KGgo="));
        // 子类型大小写不敏感：image/JPEG 归一成 image/jpeg，后缀才不会挑错
        assertArrayEquals(new String[] { "image/jpeg", "/9j/4AAQ" },
                MediaActions.imageDataUrlParts("data:image/JPEG;base64,/9j/4AAQ"));

        // base64 里允许换行：调用方拼接过或从 HTML 里取出来时可能是折行的
        String[] wrapped = MediaActions.imageDataUrlParts("data:image/png;base64,iVBOR\nw0KGgo=");
        assertEquals(2, wrapped.length);
        assertEquals("image/png", wrapped[0]);
        assertEquals("iVBOR\nw0KGgo=", wrapped[1]);
    }

    /** 不是图片 dataUrl 的一律给 null：调用方据此回 failure，而不是静默写空文件。 */
    @Test
    public void rejectsNonImageOrMalformedDataUrl() {
        assertNull(MediaActions.imageDataUrlParts(null));
        assertNull(MediaActions.imageDataUrlParts(""));
        assertNull(MediaActions.imageDataUrlParts("data:image/png;base64,"));
        assertNull(MediaActions.imageDataUrlParts("data:text/plain;base64,aGk="));
        assertNull(MediaActions.imageDataUrlParts("data:image/png,notbase64"));
        assertNull(MediaActions.imageDataUrlParts("https://example.com/qr.png"));
        assertNull(MediaActions.imageDataUrlParts("iVBORw0KGgo="));
    }

    /** 相册只收 PNG 与 JPEG，其余格式明确拒绝。 */
    @Test
    public void galleryAcceptsPngAndJpegOnly() {
        assertTrue(MediaActions.isGalleryImageMime("image/png"));
        assertTrue(MediaActions.isGalleryImageMime("image/jpeg"));
        assertTrue(MediaActions.isGalleryImageMime("image/jpg"));
        assertFalse(MediaActions.isGalleryImageMime("image/webp"));
        assertFalse(MediaActions.isGalleryImageMime("image/gif"));
        assertFalse(MediaActions.isGalleryImageMime("image/svg+xml"));
        assertFalse(MediaActions.isGalleryImageMime(null));
    }

    /** 调用方给了展示名就用它（去掉首尾空白）。 */
    @Test
    public void keepsRequestedGalleryName() {
        assertEquals("报名二维码.png", MediaActions.galleryFileName("image/png", "报名二维码.png"));
        assertEquals("qr.png", MediaActions.galleryFileName("image/png", "  qr.png  "));
    }

    /** 没给展示名时用 calmobile-qr-<时间戳>.<后缀>，后缀跟着 mime 走。 */
    @Test
    public void defaultGalleryNameCarriesTimestampAndSuffix() {
        String png = MediaActions.galleryFileName("image/png", "");
        assertTrue(png, png.matches("^calmobile-qr-\\d{8}_\\d{6}\\.png$"));
        String jpeg = MediaActions.galleryFileName("image/jpeg", null);
        assertTrue(jpeg, jpeg.matches("^calmobile-qr-\\d{8}_\\d{6}\\.jpg$"));
    }

    /** 文本导入按 UTF-8 解码，并剥掉 UTF-8 BOM（JSON.parse 遇到 BOM 会直接报错）。 */
    @Test
    public void stripsUtf8BomWhenDecoding() {
        byte[] body = "中文语言包".getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[body.length + 3];
        withBom[0] = (byte) 0xEF;
        withBom[1] = (byte) 0xBB;
        withBom[2] = (byte) 0xBF;
        System.arraycopy(body, 0, withBom, 3, body.length);

        assertEquals("中文语言包", MediaActions.decodeText(withBom));
        assertEquals("中文语言包", MediaActions.decodeText(body));
        assertEquals("", MediaActions.decodeText(new byte[0]));
        assertEquals("", MediaActions.decodeText(new byte[] { (byte) 0xEF, (byte) 0xBB, (byte) 0xBF }));
        assertNull(MediaActions.stripBom(null));
    }

    /** 超限原因要说清上限和超出多少；刚好等于上限不算超，没超限返回 null。 */
    @Test
    public void explainsOversizedTextImport() {
        int limit = MediaActions.TEXT_IMPORT_MAX_BYTES;
        assertNull(MediaActions.textTooLargeReason(1024, 1024, limit));
        // 读满上限且 Provider 声明更大，仍算没超（readAtMostBytes 只会多读一字节）
        assertNull(MediaActions.textTooLargeReason(limit, limit + 1, limit));

        String declared = MediaActions.textTooLargeReason(limit + 1, 1024 * 1024, limit);
        assertTrue(declared, declared.contains("1048576"));
        assertTrue(declared, declared.contains("超过上限 524288"));
        assertTrue(declared, declared.contains("超出 524288"));

        // Provider 不报大小时只承诺「超过上限」，不编造总大小
        String unknown = MediaActions.textTooLargeReason(limit + 1, -1, limit);
        assertTrue(unknown, unknown.contains("超过上限 524288"));
        assertFalse(unknown, unknown.contains("超出"));
    }
}
