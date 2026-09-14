package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** 保存管理员可调整的应用外观与公告设置。 */
public final class AppSettings {
    private static final String PREFS = "app_settings";
    private static final String KEY_THEME = "theme";
    private static final String KEY_ANNOUNCEMENT = "announcement";
    private static final String KEY_ANNOUNCEMENT_ENABLED = "announcement_enabled";
    private static final String KEY_CATEGORIES = "categories";
    private static final String KEY_REVIEW_REEDIT = "review_reedit";
    private static final String KEY_MEDIA_IMAGE_COUNT = "media_image_count";
    private static final String KEY_MEDIA_IMAGE_SIZE = "media_image_size";
    private static final String KEY_MEDIA_VIDEO_COUNT = "media_video_count";

    // 预设色号与 newUI 的橙色强调保持协调，管理员可在设置页直接选择。
    private static final int[] ACCENTS = {
            Color.rgb(192, 86, 33),   // #C05621 焦糖橙
            Color.rgb(72, 81, 93),    // #48515D 石墨
            Color.rgb(36, 93, 60),    // #245D3C 森林绿
            Color.rgb(47, 111, 143),  // #2F6F8F 海湾蓝
            Color.rgb(138, 90, 68),   // #8A5A44 赤陶
            Color.rgb(107, 91, 149),  // #6B5B95 紫灰
            Color.rgb(47, 107, 90),   // #2F6B5A 松针
            Color.rgb(122, 79, 90),   // #7A4F5A 酒红
            Color.rgb(177, 125, 44),  // #B17D2C 琥珀
            Color.rgb(86, 103, 116)   // #566774 雾蓝灰
    };

    private AppSettings() { }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static int getThemeIndex(Context context) {
        int value = prefs(context).getInt(KEY_THEME, 1);
        return value >= 0 && value < ACCENTS.length ? value : 1;
    }

    public static int getAccentColor(Context context) {
        return ACCENTS[getThemeIndex(context)];
    }

    public static int[] getAccentColors() {
        return ACCENTS.clone();
    }

    public static void setThemeIndex(Context context, int index) {
        int safeIndex = index >= 0 && index < ACCENTS.length ? index : 0;
        prefs(context).edit().putInt(KEY_THEME, safeIndex).apply();
    }

    public static String getAnnouncement(Context context) {
        return prefs(context).getString(KEY_ANNOUNCEMENT, "").trim();
    }

    public static boolean isAnnouncementEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ANNOUNCEMENT_ENABLED, false);
    }

    public static void saveAnnouncement(Context context, String text, boolean enabled) {
        prefs(context).edit()
                .putString(KEY_ANNOUNCEMENT, text == null ? "" : text.trim())
                .putBoolean(KEY_ANNOUNCEMENT_ENABLED, enabled)
                .apply();
    }

    public static List<String> getCategories(Context context) {
        List<String> result = new ArrayList<>();
        for (String item : categorySource(context).split("[|\\n]")) {
            if (item.trim().length() > 0) result.add(item.trim());
        }
        return result;
    }

    public static void saveCategories(Context context, List<String> categories) {
        prefs(context).edit().putString(KEY_CATEGORIES,
                android.text.TextUtils.join("|", categories)).apply();
    }

    /** 兼容旧版用换行分隔分类的历史数据，写入时统一使用竖线。 */
    private static String categorySource(Context context) {
        String saved = prefs(context).getString(KEY_CATEGORIES,
                "智能家居|物流技术|医疗健康|新材料");
        return saved == null ? "" : saved;
    }

    public static boolean canReviseReviewedRegistration(Context context) {
        return prefs(context).getBoolean(KEY_REVIEW_REEDIT, false);
    }

    public static void setCanReviseReviewedRegistration(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_REVIEW_REEDIT, enabled).apply();
    }

    // ── 富文本媒体限制（newUI 系统设置页） ─────────────────────
    // 默认值与旧版系统设置表单保持一致，改动后同时作用于 WebView 富文本编辑器。

    public static int getMediaImageLimit(Context context) {
        return prefs(context).getInt(KEY_MEDIA_IMAGE_COUNT, 8);
    }

    public static int getMediaImageSizeMb(Context context) {
        return prefs(context).getInt(KEY_MEDIA_IMAGE_SIZE, 10);
    }

    public static int getMediaVideoLimit(Context context) {
        return prefs(context).getInt(KEY_MEDIA_VIDEO_COUNT, 2);
    }

    public static void saveMediaLimits(Context context, int imageCount, int imageSizeMb, int videoCount) {
        prefs(context).edit()
                .putInt(KEY_MEDIA_IMAGE_COUNT, Math.max(1, imageCount))
                .putInt(KEY_MEDIA_IMAGE_SIZE, Math.max(1, imageSizeMb))
                .putInt(KEY_MEDIA_VIDEO_COUNT, Math.max(0, videoCount))
                .apply();
    }

    /** 将当前主题色应用到系统栏，进入页面时即可看到配色变化。 */
    public static void applyWindowColors(Activity activity) {
        int accent = getAccentColor(activity);
        activity.getWindow().setStatusBarColor(lighten(accent, 0.88f));
        activity.getWindow().setNavigationBarColor(Color.WHITE);
    }

    private static int lighten(int color, float amount) {
        int r = Color.red(color) + Math.round((255 - Color.red(color)) * amount);
        int g = Color.green(color) + Math.round((255 - Color.green(color)) * amount);
        int b = Color.blue(color) + Math.round((255 - Color.blue(color)) * amount);
        return Color.rgb(Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }
}
