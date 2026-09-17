package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 保存管理员可调整的应用设置。
 * <p>
 * 其中公告、展会分类、审核策略、媒体限制与各类字符数上限属于“服务器设置”：
 * 管理员保存后对所有用户生效，前端只读取、不允许普通用户修改。应用配色因为
 * 与个人使用偏好相关，保留在个人页的设置栏中，但仍写入同一份存储。
 */
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
    private static final String KEY_MEDIA_AVATAR_SIZE = "media_avatar_size";
    private static final String KEY_MEDIA_IMAGE_FORMATS = "media_image_formats";
    private static final String KEY_MEDIA_VIDEO_FORMATS = "media_video_formats";
    private static final String KEY_LIMIT_TITLE = "limit_exhibition_title";
    private static final String KEY_LIMIT_VENUE = "limit_exhibition_venue";
    private static final String KEY_LIMIT_CATEGORY = "limit_category";
    private static final String KEY_LIMIT_FIELD = "limit_field_title";
    private static final String KEY_LIMIT_USERNAME_MIN = "limit_username_min";
    private static final String KEY_LIMIT_USERNAME_MAX = "limit_username_max";
    private static final String KEY_LIMIT_PASSWORD_MIN = "limit_password_min";
    private static final String KEY_LIMIT_PASSWORD_MAX = "limit_password_max";
    private static final String KEY_LIMIT_NICKNAME = "limit_nickname";
    private static final String KEY_LIMIT_BIO = "limit_bio";
    private static final String KEY_LIMIT_REGION = "limit_region";
    private static final String KEY_LIMIT_ANSWER = "limit_answer";
    private static final String KEY_APP_TITLE_ZH = "app_title_zh";
    private static final String KEY_APP_TITLE_EN = "app_title_en";
    private static final String KEY_UI_MODE = "ui_mode";

    /** 外观模式：auto 跟随系统，light / dark 由用户显式选择。 */
    public static final String MODE_AUTO = "auto";
    public static final String MODE_LIGHT = "light";
    public static final String MODE_DARK = "dark";

    /** 默认允许上传的图片与视频格式（英文逗号分隔的后缀列表）。 */
    public static final String DEFAULT_IMAGE_FORMATS = "jpg,jpeg,png,webp,gif";
    public static final String DEFAULT_VIDEO_FORMATS = "mp4,mov,webm,m4v";

    /** 软件标题的默认值，与设计稿首页上方的中英文标题一致。 */
    public static final String DEFAULT_APP_TITLE_ZH = "发现展会";
    public static final String DEFAULT_APP_TITLE_EN = "calMobile";

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
        // 默认取第一个色号（#C05621 焦糖橙），与设计令牌里的 --accent 保持一致，
        // 这样未做任何设置时应用配色就是设计稿的强调色。
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
        if (isDarkMode(activity)) {
            // 深色模式下状态栏跟随页面底色，避免顶部出现一条亮色。
            int surface = Color.rgb(0x17, 0x1A, 0x1F);
            activity.getWindow().setStatusBarColor(surface);
            activity.getWindow().setNavigationBarColor(surface);
            return;
        }
        int accent = getAccentColor(activity);
        activity.getWindow().setStatusBarColor(lighten(accent, 0.88f));
        activity.getWindow().setNavigationBarColor(Color.WHITE);
    }

    /** 页面底色：深色模式下的容器与 WebView 底色，避免首帧闪白。 */
    public static int getScreenColor(Context context) {
        return isDarkMode(context) ? Color.rgb(0x17, 0x1A, 0x1F) : Color.WHITE;
    }

    // ── 外观模式（深色模式） ───────────────────────────────────
    // 与配色一样属于个人偏好，保存在本机；前端据此给 <html> 写 data-mode。

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

    /** 归一化外观模式，供桥接层与设置页共用。 */
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

    private static int lighten(int color, float amount) {
        int r = Color.red(color) + Math.round((255 - Color.red(color)) * amount);
        int g = Color.green(color) + Math.round((255 - Color.green(color)) * amount);
        int b = Color.blue(color) + Math.round((255 - Color.blue(color)) * amount);
        return Color.rgb(Math.min(255, r), Math.min(255, g), Math.min(255, b));
    }

    // ── 软件标题（服务器设置） ─────────────────────────────────────

    public static String getAppTitleZh(Context context) {
        String value = prefs(context).getString(KEY_APP_TITLE_ZH, DEFAULT_APP_TITLE_ZH);
        return value == null || value.trim().isEmpty() ? DEFAULT_APP_TITLE_ZH : value.trim();
    }

    public static String getAppTitleEn(Context context) {
        String value = prefs(context).getString(KEY_APP_TITLE_EN, DEFAULT_APP_TITLE_EN);
        return value == null || value.trim().isEmpty() ? DEFAULT_APP_TITLE_EN : value.trim();
    }

    /** 保存中英文标题；空值回落到默认标题，避免首页出现空白。 */
    public static void saveAppTitle(Context context, String zh, String en) {
        String titleZh = zh == null || zh.trim().isEmpty() ? DEFAULT_APP_TITLE_ZH : zh.trim();
        String titleEn = en == null || en.trim().isEmpty() ? DEFAULT_APP_TITLE_EN : en.trim();
        prefs(context).edit()
                .putString(KEY_APP_TITLE_ZH, titleZh)
                .putString(KEY_APP_TITLE_EN, titleEn)
                .apply();
    }

    // ── 上传格式与头像限制 ─────────────────────────────────────
    // 后缀列表由管理员以“jpg,png”形式填写，保存前统一去空格、转小写、去掉点号。

    public static int getMediaAvatarSizeMb(Context context) {
        return Math.max(1, prefs(context).getInt(KEY_MEDIA_AVATAR_SIZE, 2));
    }

    public static List<String> getImageFormats(Context context) {
        return splitFormats(prefs(context).getString(KEY_MEDIA_IMAGE_FORMATS, DEFAULT_IMAGE_FORMATS));
    }

    public static List<String> getVideoFormats(Context context) {
        return splitFormats(prefs(context).getString(KEY_MEDIA_VIDEO_FORMATS, DEFAULT_VIDEO_FORMATS));
    }

    /** 保存上传限制；格式列表为空时保留原值，避免管理员误清空导致无法上传。 */
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

    // ── 表单字符数上限（普通用户与展商可自由填写的字段） ─────────

    /**
     * 字符数上限的唯一来源。
     *
     * 之前这里散着四组按位置对齐的数组（键名、默认值、下限、上限）外加十二个
     * getter，新增一项上限要同时改六处、还要保证下标不错位；前端也各抄一份键名。
     * 现在只有这张表：{@code wireName} 就是前端 {@code state.limits} 的键，
     * 读（{@link #getTextLimit}）、写（{@link #saveTextLimits}）、与前端交换
     * （{@link SessionActions#textLimits}、{@link SystemActions#saveSettings}）全部由它派生。
     */
    public enum TextLimit {
        EXHIBITION_TITLE("exhibitionTitle", KEY_LIMIT_TITLE, 60, 4, 120),
        EXHIBITION_VENUE("exhibitionVenue", KEY_LIMIT_VENUE, 60, 4, 120),
        CATEGORY("category", KEY_LIMIT_CATEGORY, 20, 2, 60),
        FIELD_TITLE("fieldTitle", KEY_LIMIT_FIELD, 30, 2, 60),
        USERNAME_MIN("usernameMin", KEY_LIMIT_USERNAME_MIN, 3, 2, 20),
        USERNAME_MAX("usernameMax", KEY_LIMIT_USERNAME_MAX, 20, 4, 40),
        PASSWORD_MIN("passwordMin", KEY_LIMIT_PASSWORD_MIN, 6, 4, 24),
        PASSWORD_MAX("passwordMax", KEY_LIMIT_PASSWORD_MAX, 32, 8, 64),
        NICKNAME("nickname", KEY_LIMIT_NICKNAME, 20, 2, 40),
        BIO("bio", KEY_LIMIT_BIO, 200, 20, 1000),
        REGION("region", KEY_LIMIT_REGION, 40, 4, 120),
        ANSWER("answer", KEY_LIMIT_ANSWER, 200, 20, 1000);

        /** 前端 {@code state.limits} 里的键名，也是设置接口的字段名。 */
        public final String wireName;
        private final String prefKey;
        /** 取值范围与默认值；包内可见，便于单测直接校验这张表本身是否自洽。 */
        final int fallback;
        final int min;
        final int max;

        TextLimit(String wireName, String prefKey, int fallback, int min, int max) {
            this.wireName = wireName;
            this.prefKey = prefKey;
            this.fallback = fallback;
            this.min = min;
            this.max = max;
        }
    }

    /** 读取一项上限；越界值按该项的范围收敛。 */
    public static int getTextLimit(Context context, TextLimit limit) {
        int value = prefs(context).getInt(limit.prefKey, limit.fallback);
        value = Math.max(limit.min, Math.min(limit.max, value));
        // 成对的两项：上限不能小于下限，否则校验规则会互相打架。
        return Math.max(value, pairedFloor(context, limit));
    }

    /** 用户名 / 密码的「上限」以各自下限为地板。 */
    private static int pairedFloor(Context context, TextLimit limit) {
        switch (limit) {
            case USERNAME_MAX:
                return getTextLimit(context, TextLimit.USERNAME_MIN);
            case PASSWORD_MAX:
                return getTextLimit(context, TextLimit.PASSWORD_MIN);
            default:
                return 0;
        }
    }

    public static int getExhibitionTitleLimit(Context context) {
        return getTextLimit(context, TextLimit.EXHIBITION_TITLE);
    }

    public static int getExhibitionVenueLimit(Context context) {
        return getTextLimit(context, TextLimit.EXHIBITION_VENUE);
    }

    public static int getCategoryLimit(Context context) {
        return getTextLimit(context, TextLimit.CATEGORY);
    }

    public static int getFieldTitleLimit(Context context) {
        return getTextLimit(context, TextLimit.FIELD_TITLE);
    }

    public static int getUsernameMin(Context context) {
        return getTextLimit(context, TextLimit.USERNAME_MIN);
    }

    public static int getUsernameMax(Context context) {
        return getTextLimit(context, TextLimit.USERNAME_MAX);
    }

    public static int getPasswordMin(Context context) {
        return getTextLimit(context, TextLimit.PASSWORD_MIN);
    }

    public static int getPasswordMax(Context context) {
        return getTextLimit(context, TextLimit.PASSWORD_MAX);
    }

    public static int getNicknameLimit(Context context) {
        return getTextLimit(context, TextLimit.NICKNAME);
    }

    public static int getBioLimit(Context context) {
        return getTextLimit(context, TextLimit.BIO);
    }

    public static int getRegionLimit(Context context) {
        return getTextLimit(context, TextLimit.REGION);
    }

    /** 报名表单里用户自由填写的文本长度上限。 */
    public static int getAnswerLimit(Context context) {
        return getTextLimit(context, TextLimit.ANSWER);
    }

    /**
     * 一次性写入全部字符数上限。
     *
     * @param values 前端提交的键值对，缺项或非正数保持默认值，越界值按上下限收敛
     */
    public static void saveTextLimits(Context context, Map<String, Integer> values) {
        SharedPreferences.Editor editor = prefs(context).edit();
        for (TextLimit limit : TextLimit.values()) {
            Integer submitted = values == null ? null : values.get(limit.wireName);
            int value = submitted != null && submitted > 0 ? submitted : limit.fallback;
            editor.putInt(limit.prefKey, Math.max(limit.min, Math.min(limit.max, value)));
        }
        editor.apply();
    }
}
