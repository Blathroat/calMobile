package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 设备侧的外观与媒体限制**镜像**。
 *
 * 服务器设置（软件标题、公告、分类、审核策略、字符数上限）与个人偏好现在都由后端持有
 * （`server/` 的 `app_settings` 与 `users.ui_mode`），前端从接口拿。
 * 但有两类东西只能在设备上生效，原生必须自己知道：
 *
 * - **系统栏配色**：状态栏 / 导航栏颜色、深色模式下 WebView 的底色；
 * - **媒体压缩与格式上限**：选图后压缩到多大、允许哪些后缀。
 *
 * 因此这份存储不再是「数据的权威来源」，而是前端通过 `ui.sync` 动作推过来的镜像：
 * 值由后端决定，这里只负责在原生需要时能同步读到。
 */
public final class AppSettings {
    private static final String PREFS = "app_settings";
    private static final String KEY_THEME = "theme";
    private static final String KEY_MEDIA_IMAGE_COUNT = "media_image_count";
    private static final String KEY_MEDIA_IMAGE_SIZE = "media_image_size";
    private static final String KEY_MEDIA_VIDEO_COUNT = "media_video_count";
    private static final String KEY_MEDIA_AVATAR_SIZE = "media_avatar_size";
    private static final String KEY_MEDIA_IMAGE_FORMATS = "media_image_formats";
    private static final String KEY_MEDIA_VIDEO_FORMATS = "media_video_formats";
    private static final String KEY_UI_MODE = "ui_mode";

    /** 外观模式：auto 跟随系统，light / dark 由用户显式选择。 */
    public static final String MODE_AUTO = "auto";
    public static final String MODE_LIGHT = "light";
    public static final String MODE_DARK = "dark";

    /** 深色模式下页面底色，与前端 tokens.css 的 --screen 深色值一致（同样写字面量）。 */
    private static final int DARK_SURFACE = 0xFF171A1F;

    /** 默认允许上传的图片与视频格式（后缀列表）。 */
    public static final String DEFAULT_IMAGE_FORMATS = "jpg,jpeg,png,webp,gif";
    public static final String DEFAULT_VIDEO_FORMATS = "mp4,mov,webm,m4v";

    // 预设色号与 newUI 的橙色强调保持协调，前端 settings 里的 theme.index 指的是这里的下标。
    // 直接写 0xAARRGGBB 字面量而不是 Color.rgb(...)：静态初始化不碰 Android API，
    // 这两个归一化函数才能在普通 JVM 单测里跑。
    private static final int[] ACCENTS = {
            0xFFC05621,   // #C05621 焦糖橙
            0xFF48515D,   // #48515D 石墨
            0xFF245D3C,   // #245D3C 森林绿
            0xFF2F6F8F,   // #2F6F8F 海湾蓝
            0xFF8A5A44,   // #8A5A44 赤陶
            0xFF6B5B95,   // #6B5B95 紫灰
            0xFF2F6B5A,   // #2F6B5A 松针
            0xFF7A4F5A,   // #7A4F5A 酒红
            0xFFB17D2C,   // #B17D2C 琥珀
            0xFF566774    // #566774 雾蓝灰
    };

    private AppSettings() { }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── 配色 ───────────────────────────────────────────────────────

    public static int getThemeIndex(Context context) {
        int value = prefs(context).getInt(KEY_THEME, 0);
        return value >= 0 && value < ACCENTS.length ? value : 0;
    }

    public static int getAccentColor(Context context) {
        return ACCENTS[getThemeIndex(context)];
    }

    public static void setThemeIndex(Context context, int index) {
        int safeIndex = index >= 0 && index < ACCENTS.length ? index : 0;
        prefs(context).edit().putInt(KEY_THEME, safeIndex).apply();
    }

    // ── 外观模式（深色模式） ───────────────────────────────────────

    /** 读取外观模式，非法值回落到跟随系统。 */
    public static String getUiMode(Context context) {
        String value = prefs(context).getString(KEY_UI_MODE, MODE_AUTO);
        if (MODE_LIGHT.equals(value) || MODE_DARK.equals(value)) {
            return value;
        }
        return MODE_AUTO;
    }

    public static void setUiMode(Context context, String mode) {
        prefs(context).edit().putString(KEY_UI_MODE, normalizeMode(mode)).apply();
    }

    /** 归一化外观模式，供桥接层共用。 */
    public static String normalizeMode(String mode) {
        if (MODE_LIGHT.equals(mode) || MODE_DARK.equals(mode)) {
            return mode;
        }
        return MODE_AUTO;
    }

    /** 当前是否使用深色外观：auto 时跟随系统。 */
    public static boolean isDarkMode(Context context) {
        String mode = getUiMode(context);
        if (MODE_DARK.equals(mode)) {
            return true;
        }
        if (MODE_LIGHT.equals(mode)) {
            return false;
        }
        return (context.getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    // ── 系统栏颜色 ─────────────────────────────────────────────────

    /** 将当前配色应用到系统栏；进入页面与外观变化后都要调一次。 */
    public static void applyWindowColors(Activity activity) {
        if (isDarkMode(activity)) {
            // 深色模式下状态栏跟随页面底色，避免顶部出现一条亮色。
            activity.getWindow().setStatusBarColor(DARK_SURFACE);
            activity.getWindow().setNavigationBarColor(DARK_SURFACE);
            return;
        }
        int accent = getAccentColor(activity);
        activity.getWindow().setStatusBarColor(lighten(accent, 0.88f));
        activity.getWindow().setNavigationBarColor(Color.WHITE);
    }

    /** 页面底色：深色模式下的容器与 WebView 底色，避免首帧闪白。 */
    public static int getScreenColor(Context context) {
        return isDarkMode(context) ? DARK_SURFACE : Color.WHITE;
    }

    private static int lighten(int color, float amount) {
        int r = Color.red(color) + Math.round((255 - Color.red(color)) * amount);
        int g = Color.green(color) + Math.round((255 - Color.green(color)) * amount);
        int b = Color.blue(color) + Math.round((255 - Color.blue(color)) * amount);
        return Color.rgb(Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }

    // ── 媒体限制（镜像自服务器设置） ───────────────────────────────

    public static int getMediaImageLimit(Context context) {
        return Math.max(1, prefs(context).getInt(KEY_MEDIA_IMAGE_COUNT, 8));
    }

    public static int getMediaImageSizeMb(Context context) {
        return Math.max(1, prefs(context).getInt(KEY_MEDIA_IMAGE_SIZE, 10));
    }

    public static int getMediaVideoLimit(Context context) {
        return Math.max(0, prefs(context).getInt(KEY_MEDIA_VIDEO_COUNT, 2));
    }

    public static void saveMediaLimits(Context context, int imageCount, int imageSizeMb, int videoCount) {
        prefs(context).edit()
                .putInt(KEY_MEDIA_IMAGE_COUNT, Math.max(1, imageCount))
                .putInt(KEY_MEDIA_IMAGE_SIZE, Math.max(1, imageSizeMb))
                .putInt(KEY_MEDIA_VIDEO_COUNT, Math.max(0, videoCount))
                .apply();
    }

    public static int getMediaAvatarSizeMb(Context context) {
        return Math.max(1, prefs(context).getInt(KEY_MEDIA_AVATAR_SIZE, 2));
    }

    public static List<String> getImageFormats(Context context) {
        return splitFormats(prefs(context).getString(KEY_MEDIA_IMAGE_FORMATS, DEFAULT_IMAGE_FORMATS));
    }

    public static List<String> getVideoFormats(Context context) {
        return splitFormats(prefs(context).getString(KEY_MEDIA_VIDEO_FORMATS, DEFAULT_VIDEO_FORMATS));
    }

    /** 保存上传限制；格式列表为空时保留原值，避免误清空导致无法上传。 */
    public static void saveUploadLimits(Context context, int avatarSizeMb, String imageFormats,
            String videoFormats) {
        SharedPreferences.Editor editor = prefs(context).edit()
                .putInt(KEY_MEDIA_AVATAR_SIZE, Math.max(1, avatarSizeMb));
        if (!splitFormats(imageFormats).isEmpty()) {
            editor.putString(KEY_MEDIA_IMAGE_FORMATS, String.join(",", splitFormats(imageFormats)));
        }
        if (!splitFormats(videoFormats).isEmpty()) {
            editor.putString(KEY_MEDIA_VIDEO_FORMATS, String.join(",", splitFormats(videoFormats)));
        }
        editor.apply();
    }

    /** 归一化后缀列表：去掉点号与空格、转小写、去重并保持顺序。 */
    public static List<String> splitFormats(String raw) {
        List<String> result = new ArrayList<>();
        if (raw == null) {
            return result;
        }
        for (String item : raw.split("[,\\s]+")) {
            String value = item.trim().toLowerCase(Locale.US);
            if (value.startsWith(".")) {
                value = value.substring(1);
            }
            if (!value.isEmpty() && !result.contains(value)) {
                result.add(value);
            }
        }
        return result;
    }
}
