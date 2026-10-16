package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/**
 * 设备侧镜像的纯函数部分。
 *
 * `AppSettings` 现在只保存「原生需要知道」的东西（外观模式、配色下标、媒体上限），
 * 服务器设置由后端持有，因此这里只测不依赖 Android 运行时的归一化逻辑。
 */
public class AppSettingsTest {

    /** 外观模式只接受 light、dark、auto。 */
    @Test
    public void acceptsOnlyThreeAppearanceModes() {
        assertEquals(AppSettings.MODE_LIGHT, AppSettings.normalizeMode("light"));
        assertEquals(AppSettings.MODE_DARK, AppSettings.normalizeMode("dark"));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("auto"));
    }

    /** 非法外观模式回落到跟随系统。 */
    @Test
    public void fallsBackToSystemAppearance() {
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("乱填"));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode(""));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode(null));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("DARK"));
    }

    /** 后缀列表会去掉点号和空格，并转成小写。 */
    @Test
    public void stripsDotsSpacesAndLowercasesFormats() {
        List<String> formats = AppSettings.splitFormats(" .JPG, png ,,JPEG ");
        assertEquals(Arrays.asList("jpg", "png", "jpeg"), formats);
    }

    /** 后缀列表去重，并保持第一次出现的顺序。 */
    @Test
    public void dedupesFormatsInOrder() {
        assertEquals(Arrays.asList("png", "jpg"), AppSettings.splitFormats("png,jpg,png"));
    }

    /** 空的后缀列表返回空表。 */
    @Test
    public void returnsEmptyFormatList() {
        assertTrue(AppSettings.splitFormats(null).isEmpty());
        assertTrue(AppSettings.splitFormats("").isEmpty());
        assertTrue(AppSettings.splitFormats(" , ").isEmpty());
    }

    /**
     * 前端推过来的格式是数组，经桥接可能变成 `[mp4,mov,webm]`；手输时也可能用顿号分隔。
     * 只按逗号切会把 `[mp4` 与 `webm]` 当成后缀名，于是「允许 mp4」却判定 mp4 非法
     * （真机上表现为选完视频提示「服务器设置不允许上传 .mp4 格式」）。
     */
    @Test
    public void acceptsBracketedAndEnumerationFormats() {
        assertEquals(Arrays.asList("mp4", "mov", "webm"), AppSettings.splitFormats("[mp4,mov,webm]"));
        assertEquals(Arrays.asList("jpg", "png"), AppSettings.splitFormats("[jpg, png]"));
        assertEquals(Arrays.asList("mp4", "mov"), AppSettings.splitFormats("mp4、mov"));
        assertEquals(Arrays.asList("mp4", "mov"), AppSettings.splitFormats("\"mp4\", \"mov\""));
        assertEquals(Arrays.asList("jpg", "png"), AppSettings.splitFormats("JPG; PNG"));
    }

    /** 默认格式非空，并且不含点号。 */
    @Test
    public void defaultFormatsAreNonEmptyAndUnprefixed() {
        List<String> images = AppSettings.splitFormats(AppSettings.DEFAULT_IMAGE_FORMATS);
        List<String> videos = AppSettings.splitFormats(AppSettings.DEFAULT_VIDEO_FORMATS);
        assertFalse(images.isEmpty());
        assertFalse(videos.isEmpty());
        for (String format : images) {
            assertFalse("默认格式不应带点号：" + format, format.startsWith("."));
        }
    }

    /**
     * 媒体上限的取值区间必须与后端 `server/src/domain/settings.js` 的 clamp 一致：
     * 后端是权威，原生这边只把越界值收敛到同一个区间。
     */
    @Test
    public void clampsMediaLimitsToServerRange() {
        assertEquals(1, AppSettings.clampImageCount(0));
        assertEquals(30, AppSettings.clampImageCount(999));
        assertEquals(8, AppSettings.clampImageCount(8));

        assertEquals(1, AppSettings.clampImageSizeMb(-5));
        assertEquals(50, AppSettings.clampImageSizeMb(500));
        assertEquals(10, AppSettings.clampImageSizeMb(10));

        // 视频数量允许 0（= 不允许上传视频），上限 10
        assertEquals(0, AppSettings.clampVideoCount(-1));
        assertEquals(0, AppSettings.clampVideoCount(0));
        assertEquals(10, AppSettings.clampVideoCount(11));
        assertEquals(2, AppSettings.clampVideoCount(2));

        // 视频大小 1..500 MB：以前这里没有上限，选个几 GB 的文件会写满数据分区
        assertEquals(1, AppSettings.clampVideoSizeMb(0));
        assertEquals(500, AppSettings.clampVideoSizeMb(9999));
        assertEquals(50, AppSettings.clampVideoSizeMb(50));
    }

    /**
     * 强调色下标必须与后端 `THEME_COLORS` 逐位对应：前端下发 `theme.index`，
     * 原生据此画状态栏；错位会让「页面是紫色、状态栏却是别的颜色」。
     * 8 色色板的下标 0..7 都要有值，且不能有两种下标撞成同一个颜色。
     */
    @Test
    public void accentIndexesMatchServerPalette() {
        int[] expected = {
                0xFFC05621, 0xFF48515D, 0xFF245D3C, 0xFF2F6F8F,
                0xFF334E7D, 0xFF0E6E62, 0xFF6B3FA0, 0xFFA32C5E,
        };
        for (int index = 0; index < expected.length; index++) {
            assertEquals("下标 " + index + " 的强调色与后端不一致", expected[index], AppSettings.accentColorAt(index));
        }
        // 越界回落到默认的焦糖橙，而不是抛异常或取到别的色
        assertEquals(0xFFC05621, AppSettings.accentColorAt(-1));
        assertEquals(0xFFC05621, AppSettings.accentColorAt(expected.length));
    }
}
