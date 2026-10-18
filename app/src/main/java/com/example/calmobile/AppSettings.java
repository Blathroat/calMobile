package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;

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
    private static final String KEY_MEDIA_VIDEO_SIZE = "media_video_size";
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

    // 预设色号与后端 `server/src/config/migrate.ts` 的 `THEME_COLORS` **逐位对应**：
    // 前端 settings 里的 `theme.index` 就是这个数组的下标，两边一旦错位，
    // 页面强调色与状态栏颜色就对不上。后端 12 色，这里必须也是 12 色、顺序一致。
    // 直接写 0xAARRGGBB 字面量而不是 Color.rgb(...)：静态初始化不碰 Android API，
    // 这两个归一化函数才能在普通 JVM 单测里跑。
    private static final int[] ACCENTS = {
            0xFFC05621,   // 0 #C05621 焦糖橙（默认）
            0xFF48515D,   // 1 #48515D 石墨蓝灰
            0xFF245D3C,   // 2 #245D3C 森林绿
            0xFF2F6F8F,   // 3 #2F6F8F 海湾青蓝
            0xFF334E7D,   // 4 #334E7D 靛蓝
            0xFF0E6E62,   // 5 #0E6E62 墨绿
            0xFF6B3FA0,   // 6 #6B3FA0 紫
            0xFFA32C5E,   // 7 #A32C5E 玫红
            0xFF5F6B2A,   // 8 #5F6B2A 橄榄绿
            0xFFA33B3B,   // 9 #A33B3B 深红
            0xFF8E4A76,   // 10 #8E4A76 梅紫
            0xFF41707E    // 11 #41707E 钢青
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
        return accentColorAt(getThemeIndex(context));
    }

    /**
     * 按下标取强调色；越界回落到 0（默认的焦糖橙）。
     *
     * 纯函数：不读 Android API，因此可以在普通 JVM 单测里断言「下标与色板逐位对齐」。
     */
    static int accentColorAt(int index) {
        return index >= 0 && index < ACCENTS.length ? ACCENTS[index] : ACCENTS[0];
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

    /**
     * 将当前配色应用到系统栏；进入页面与外观变化后都要调一次。
     *
     * 状态栏图标的明暗必须跟着底色走：深色底配深色图标等于看不见，
     * 因此这里同时设置 `setSystemBarsAppearance`（API 30+）或
     * `SYSTEM_UI_FLAG_LIGHT_STATUS_BAR`（更低版本）。
     */
    public static void applyWindowColors(Activity activity) {
        boolean dark = isDarkMode(activity);
        if (dark) {
            // 深色模式下状态栏跟随页面底色，避免顶部出现一条亮色。
            activity.getWindow().setStatusBarColor(DARK_SURFACE);
            activity.getWindow().setNavigationBarColor(DARK_SURFACE);
        } else {
            int accent = getAccentColor(activity);
            activity.getWindow().setStatusBarColor(lighten(accent, 0.88f));
            activity.getWindow().setNavigationBarColor(Color.WHITE);
        }
        applyLightSystemBars(activity, !dark);
    }

    /**
     * 系统栏图标是否用深色（浅底用深色图标，深底用浅色图标）。
     *
     * API 30 起用 {@code WindowInsetsController}，更低版本退回已废弃的
     * {@code SYSTEM_UI_FLAG_LIGHT_STATUS_BAR} / `..._NAVIGATION_BAR`——两者都保留，
     * 因为模拟器与老设备上仍可能跑 API 24–29。
     *
     * 注意**必须从 `getDecorView()` 拿 controller**：`Window.getInsetsController()`
     * 会直接读 DecorView，而在 `onCreate` 里 `setContentView` 之前它还是 null，
     * 那条路径会抛 NPE 让应用起不来。
     */
    @SuppressWarnings("deprecation")
    private static void applyLightSystemBars(Activity activity, boolean lightIcons) {
        Window window = activity.getWindow();
        View decor = window.getDecorView();
        int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && decor != null) {
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(lightIcons ? appearance : 0, appearance);
                return;
            }
        }
        int flags = decor == null ? 0 : decor.getSystemUiVisibility();
        if (lightIcons) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if (decor != null) {
            decor.setSystemUiVisibility(flags);
        }
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
        return clampImageCount(prefs(context).getInt(KEY_MEDIA_IMAGE_COUNT, 8));
    }

    public static int getMediaImageSizeMb(Context context) {
        return clampImageSizeMb(prefs(context).getInt(KEY_MEDIA_IMAGE_SIZE, 10));
    }

    public static int getMediaVideoLimit(Context context) {
        return clampVideoCount(prefs(context).getInt(KEY_MEDIA_VIDEO_COUNT, 2));
    }

    /** 单个视频的大小上限（MB）：视频是整份复制进应用目录的，必须有上限。 */
    public static int getMediaVideoSizeMb(Context context) {
        return clampVideoSizeMb(prefs(context).getInt(KEY_MEDIA_VIDEO_SIZE, 50));
    }

    public static void saveMediaLimits(Context context, int imageCount, int imageSizeMb,
            int videoCount, int videoSizeMb) {
        prefs(context).edit()
                .putInt(KEY_MEDIA_IMAGE_COUNT, clampImageCount(imageCount))
                .putInt(KEY_MEDIA_IMAGE_SIZE, clampImageSizeMb(imageSizeMb))
                .putInt(KEY_MEDIA_VIDEO_COUNT, clampVideoCount(videoCount))
                .putInt(KEY_MEDIA_VIDEO_SIZE, clampVideoSizeMb(videoSizeMb))
                .apply();
    }

    // ── 取值范围 ───────────────────────────────────────────────────
    // 这几个范围与后端 `server/src/domain/settings.js` 的 clamp 一一对应：
    // 后端是权威，原生只是把越界值收敛到同一个区间，避免两边对「合法上限」的理解不一致。

    /** 图片数量：1..30。 */
    static int clampImageCount(int value) {
        return Math.min(30, Math.max(1, value));
    }

    /** 单张图片大小（MB）：1..50。 */
    static int clampImageSizeMb(int value) {
        return Math.min(50, Math.max(1, value));
    }

    /** 视频数量：0..10（0 表示不允许上传视频）。 */
    static int clampVideoCount(int value) {
        return Math.min(10, Math.max(0, value));
    }

    /** 单个视频大小（MB）：1..500。 */
    static int clampVideoSizeMb(int value) {
        return Math.min(500, Math.max(1, value));
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
        // 分隔符要比「逗号」宽：前端推过来的格式是数组，经桥接序列化后可能长成
        // `[mp4,mov,webm]`（Java List 的 toString）；手输时也可能用顿号或空格分隔。
        // 只按逗号切会把 `[mp4` / `webm]` 当成后缀名，于是「允许 mp4」却判定 mp4 非法。
        for (String item : raw.split("[,\\s、，;；|]+")) {
            String value = item.trim().toLowerCase(Locale.US);
            // 去掉数组/引号残留
            value = value.replace("[", "").replace("]", "").replace("\"", "").replace("'", "");
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
