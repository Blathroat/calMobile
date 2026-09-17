package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户管理与用户公开页、搜索。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class AdminActions {

    private AdminActions() {
    }

    static List<Map<String, Object>> users(Map<String, Object> payload) {
        String query = WebAppBridge.text(payload, "query", "");
        String status = WebAppBridge.text(payload, "status", "");
        List<AdminUser> source = query.isEmpty() ? AdminUserManager.listAll() : AdminUserManager.search(query);
        List<Map<String, Object>> items = new ArrayList<>();
        for (AdminUser user : source) {
            if (!status.isEmpty() && !status.equals(user.getStatus())) {
                continue;
            }
            items.add(adminUserPayload(user));
        }
        return items;
    }

    static Map<String, Object> adminUserPayload(AdminUser user) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", user.getId());
        item.put("nickname", ActionSupport.safe(user.getNickname()));
        item.put("email", ActionSupport.safe(user.getEmail()));
        item.put("status", ActionSupport.safe(user.getStatus()));
        item.put("registrationTime", ActionSupport.safe(user.getRegistrationTime()));
        item.put("lastLoginTime", ActionSupport.safe(user.getLastLoginTime()));
        item.put("role", roleFromNickname(user.getNickname()));
        return item;
    }

    static String roleFromNickname(String nickname) {
        if ("demo".equalsIgnoreCase(nickname)) {
            return "管理员";
        }
        if ("exhibitor".equalsIgnoreCase(nickname)) {
            return "展商";
        }
        return "普通用户";
    }

    static Map<String, Object> findUser(String id) {
        AdminUser user = AdminUserManager.findById(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (user == null) {
            result.put("found", false);
            result.put("error", "用户不存在");
            return result;
        }
        result.put("found", true);
        result.put("user", adminUserPayload(user));
        return result;
    }

    static AdminUser findUserByNickname(String nickname) {
        if (nickname == null || nickname.isEmpty()) {
            return null;
        }
        for (AdminUser user : AdminUserManager.listAll()) {
            if (user.getNickname() != null && user.getNickname().equalsIgnoreCase(nickname)) {
                return user;
            }
        }
        return null;
    }

    static Map<String, Object> publicProfile(Activity activity, Map<String, Object> payload) {
        String nickname = WebAppBridge.text(payload, "nickname", "");
        String userId = WebAppBridge.text(payload, "userId", "");
        AdminUser user = userId.isEmpty() ? findUserByNickname(nickname) : AdminUserManager.findById(userId);
        Map<String, Object> profile = new LinkedHashMap<>();
        if (user == null) {
            profile.put("found", false);
            profile.put("error", "用户不存在或未公开");
            return profile;
        }
        // 管理员在管理后台查看公开页时不受用户隐私设置影响，始终能看到已参加展会；
        // 普通访问者仍按 “展示我的报名” 开关过滤。
        boolean asAdmin = AuthManager.getInstance().isAdmin();
        UserProfileStore.Profile stored = UserProfileStore.get(activity, user.getNickname());
        profile.put("found", true);
        profile.put("nickname", ActionSupport.safe(user.getNickname()));
        profile.put("role", roleFromNickname(user.getNickname()));
        profile.put("bio", stored == null ? "" : stored.bio);
        profile.put("region", stored == null ? "" : stored.region);
        profile.put("avatar", stored == null ? "" : stored.avatar);
        profile.put("socialMedia", stored == null ? "" : stored.socialMedia);
        profile.put("showRegistrations", stored != null && stored.showRegistrations);
        profile.put("viewedAsAdmin", asAdmin);

        List<Map<String, Object>> registrations = new ArrayList<>();
        if (asAdmin || (stored != null && stored.showRegistrations)) {
            for (Map<String, Object> registration : RegistrationActions.myRegistrations(activity)) {
                if (ActionSupport.safe(user.getNickname()).equals(registration.get("visitorName"))) {
                    registrations.add(registration);
                }
            }
        }
        profile.put("registrations", registrations);
        return profile;
    }

    static Map<String, Object> search(Activity activity, String query) {
        List<Map<String, Object>> exhibitions = new ArrayList<>();
        List<Map<String, Object>> people = new ArrayList<>();
        if (!query.trim().isEmpty()) {
            for (ExhibitorExhibition exhibition : ExhibitionManager.search(query)) {
                exhibitions.add(ExhibitionActions.exhibitionPayload(activity, exhibition));
            }
            for (AdminUser user : AdminUserManager.search(query)) {
                people.add(adminUserPayload(user));
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("query", query);
        result.put("exhibitions", exhibitions);
        result.put("users", people);
        result.put("count", exhibitions.size() + people.size());
        return result;
    }
    /** 修改账号状态：正常 / 受限 / 封禁。 */
    static boolean updateStatus(Map<String, Object> payload) {
        return AdminUserManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                WebAppBridge.text(payload, "status", ""));
    }
}
