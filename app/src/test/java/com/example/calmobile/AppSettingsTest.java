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
}
