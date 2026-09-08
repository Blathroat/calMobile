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

    private static final int[] ACCENTS = {
            Color.rgb(22, 78, 99),
            Color.rgb(79, 70, 146),
            Color.rgb(14, 116, 144),
            Color.rgb(180, 83, 9),
            Color.rgb(190, 24, 93),
            Color.rgb(67, 56, 202),
            Color.rgb(22, 101, 52),
            Color.rgb(185, 28, 28)
    };

    private AppSettings() { }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static int getThemeIndex(Context context) {
        int value = prefs(context).getInt(KEY_THEME, 0);
        return value >= 0 && value < ACCENTS.length ? value : 0;
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
        String saved = prefs(context).getString(KEY_CATEGORIES,
                "智能家居|物流技术|医疗健康|新材料");
        List<String> result = new ArrayList<>();
        for (String item : saved.split("\\|")) {
            if (item.trim().length() > 0) result.add(item.trim());
        }
        return result;
    }

    public static void saveCategories(Context context, List<String> categories) {
        prefs(context).edit().putString(KEY_CATEGORIES,
                android.text.TextUtils.join("|", categories)).apply();
    }

    public static boolean canReviseReviewedRegistration(Context context) {
        return prefs(context).getBoolean(KEY_REVIEW_REEDIT, false);
    }

    public static void setCanReviseReviewedRegistration(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_REVIEW_REEDIT, enabled).apply();
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
