package com.example.calmobile;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Map;

/**
 * 个人主页与用户公开页的资料存储。
 * <p>
 * 现有 {@code AdminUser} 只保存昵称、邮箱和账号状态，个人简介、联系方式和公开策略属于新增字段，
 * 统一放在 SharedPreferences 中持久化，键为登录用户名。
 */
public final class UserProfileStore {

    private static final String PREFS = "user_profiles";

    /** 一位用户的公开资料。 */
    public static final class Profile {
        public String nickname = "";
        public String email = "";
        public String bio = "";
        public String contact = "";
        public String socialMedia = "";
        public boolean showRegistrations = false;
    }

    private UserProfileStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void save(Context context, String username, String nickname, String email, String bio,
            String contact, String socialMedia, boolean showRegistrations) {
        if (username == null || username.isEmpty()) {
            return;
        }
        prefs(context).edit()
                .putString(username + ".nickname", safe(nickname))
                .putString(username + ".email", safe(email))
                .putString(username + ".bio", safe(bio))
                .putString(username + ".contact", safe(contact))
                .putString(username + ".social", safe(socialMedia))
                .putBoolean(username + ".showRegistrations", showRegistrations)
                .apply();
    }

    /** 读取资料；没有保存过时返回 null，由调用方决定是否回退到账号默认值。 */
    public static Profile get(Context context, String username) {
        if (context == null || username == null || username.isEmpty()) {
            return null;
        }
        SharedPreferences store = prefs(context);
        if (!store.contains(username + ".nickname")) {
            return null;
        }
        Profile profile = new Profile();
        profile.nickname = store.getString(username + ".nickname", "");
        profile.email = store.getString(username + ".email", "");
        profile.bio = store.getString(username + ".bio", "");
        profile.contact = store.getString(username + ".contact", "");
        profile.socialMedia = store.getString(username + ".social", "");
        profile.showRegistrations = store.getBoolean(username + ".showRegistrations", false);
        return profile;
    }

    /** 按昵称读取资料，昵称大小写不敏感。 */
    public static Profile getByNickname(Context context, String nickname) {
        if (context == null || nickname == null) {
            return null;
        }
        for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
            if (!entry.getKey().endsWith(".nickname")) {
                continue;
            }
            if (nickname.equalsIgnoreCase(String.valueOf(entry.getValue()))) {
                return get(context, entry.getKey().substring(0, entry.getKey().length() - ".nickname".length()));
            }
        }
        return null;
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
