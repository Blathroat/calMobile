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

    @Test
    public void 外观模式只接受三个取值() {
        assertEquals(AppSettings.MODE_LIGHT, AppSettings.normalizeMode("light"));
        assertEquals(AppSettings.MODE_DARK, AppSettings.normalizeMode("dark"));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("auto"));
    }

    @Test
    public void 非法外观模式回落到跟随系统() {
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("乱填"));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode(""));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode(null));
        assertEquals(AppSettings.MODE_AUTO, AppSettings.normalizeMode("DARK"));
    }

    @Test
    public void 后缀列表会去点号空格并转小写() {
        List<String> formats = AppSettings.splitFormats(" .JPG, png ,,JPEG ");
        assertEquals(Arrays.asList("jpg", "png", "jpeg"), formats);
    }

    @Test
    public void 后缀列表去重且保持顺序() {
        assertEquals(Arrays.asList("png", "jpg"), AppSettings.splitFormats("png,jpg,png"));
    }

    @Test
    public void 空的后缀列表返回空表() {
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
    public void 后缀列表能容忍数组括号与顿号分隔() {
        assertEquals(Arrays.asList("mp4", "mov", "webm"), AppSettings.splitFormats("[mp4,mov,webm]"));
        assertEquals(Arrays.asList("jpg", "png"), AppSettings.splitFormats("[jpg, png]"));
        assertEquals(Arrays.asList("mp4", "mov"), AppSettings.splitFormats("mp4、mov"));
        assertEquals(Arrays.asList("mp4", "mov"), AppSettings.splitFormats("\"mp4\", \"mov\""));
        assertEquals(Arrays.asList("jpg", "png"), AppSettings.splitFormats("JPG; PNG"));
    }

    @Test
    public void 默认格式非空且不含点号() {
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
    public void 媒体上限越界时收敛到与后端一致的区间() {
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
}
