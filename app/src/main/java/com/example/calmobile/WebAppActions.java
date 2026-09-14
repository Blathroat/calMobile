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
 * WebView 前端的业务动作实现。
 * <p>
 * 复用现有的 Manager、SQLite、SharedPreferences 与日历/通知辅助类，只把结果整理成前端可直接渲染的 JSON 结构。
 */
final class WebAppActions {

    private static final String TAG = "WebAppActions";

    private WebAppActions() {
    }

    static void handle(WebAppBridge bridge, String action, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        DatabaseHelper.init(activity);
        ExhibitionManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        switch (action) {
            case "bootstrap":
                callback.success(bootstrap(activity));
                return;
            case "auth.login":
                callback.success(login(activity, payload));
                return;
            case "auth.register":
                callback.success(register(activity, payload));
                return;
            case "auth.guest":
                AuthManager.getInstance().enterAsGuest();
                callback.success(userPayload(activity));
                return;
            case "auth.logout":
                AuthManager.getInstance().logout();
                callback.success(true);
                return;
            case "profile.get":
                callback.success(userPayload(activity));
                return;
            case "profile.save":
                callback.success(saveProfile(activity, payload));
                return;
            case "profile.password":
                callback.success(changePassword(payload));
                return;
            case "notify.preferences":
                callback.success(notificationPreferences(activity));
                return;
            case "notify.savePreferences":
                saveNotificationPreferences(activity, payload);
                callback.success(notificationPreferences(activity));
                return;
            case "notify.requestPermission":
                requestNotificationPermission(bridge, callback);
                return;
            case "exhibitions.list":
                callback.success(exhibitions(activity, payload));
                return;
            case "exhibitions.month":
                callback.success(monthPayload(activity, payload));
                return;
            case "exhibitions.get":
                callback.success(findExhibition(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.save":
                callback.success(saveExhibition(activity, payload));
                return;
            case "exhibitions.delete":
                callback.success(ExhibitionManager.delete(WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.status":
                callback.success(ExhibitionManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                        WebAppBridge.text(payload, "status", "")));
                return;
            case "exhibitions.categories":
                callback.success(AppSettings.getCategories(activity));
                return;
            case "exhibitions.fields":
                callback.success(fieldsPayload(WebAppBridge.text(payload, "id", "")));
                return;
            case "exhibitions.saveFields":
                callback.success(saveFields(WebAppBridge.text(payload, "id", ""), payload));
                return;
            case "registrations.list":
                callback.success(myRegistrations(activity));
                return;
            case "registrations.get":
                callback.success(findRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "registrations.submit":
                callback.success(submitRegistration(activity, payload));
                return;
            case "registrations.cancel":
                callback.success(cancelRegistration(activity, WebAppBridge.text(payload, "id", "")));
                return;
            case "review.list":
                callback.success(reviewList(payload));
                return;
            case "review.get":
                callback.success(reviewDetail(WebAppBridge.text(payload, "id", "")));
                return;
            case "review.updateStatus":
                callback.success(updateReviewStatus(activity, payload));
                return;
            case "users.list":
                callback.success(users(payload));
                return;
            case "users.get":
                callback.success(findUser(WebAppBridge.text(payload, "id", "")));
                return;
            case "users.status":
                callback.success(AdminUserManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                        WebAppBridge.text(payload, "status", "")));
                return;
            case "users.public":
                callback.success(publicProfile(activity, payload));
                return;
            case "search.query":
                callback.success(search(activity, WebAppBridge.text(payload, "query", "")));
                return;
            case "settings.get":
                callback.success(settings(activity));
                return;
            case "settings.save":
                callback.success(saveSettings(activity, payload));
                return;
            case "calendar.status":
                callback.success(calendarStatus(activity, payload));
                return;
            case "calendar.toggle":
                toggleCalendar(bridge, payload, callback);
                return;
            case "media.imageData":
                callback.success(imageData(activity, WebAppBridge.text(payload, "uri", "")));
                return;
            case "media.pickImage":
                pickFile(bridge, "image/*", "选择图片", callback);
                return;
            case "media.pickVideo":
                pickFile(bridge, "video/*", "选择视频", callback);
                return;
            case "share.text":
                shareText(activity, payload);
                callback.success(true);
                return;
            case "export.csv":
                exportCsv(bridge, payload, callback);
                return;
            case "toast":
                toast(activity, WebAppBridge.text(payload, "message", ""));
                callback.success(true);
                return;
            default:
                callback.failure("未实现的动作：" + action);
        }
    }

    // ── 启动数据 ───────────────────────────────────────────────

    private static Map<String, Object> bootstrap(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user", userPayload(activity));
        data.put("theme", themePayload(activity));
        data.put("capabilities", capabilities(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", reviewPolicy(activity));
        data.put("media", mediaLimits(activity));
        data.put("announcement", announcement(activity));
        Map<String, Object> calendar = new LinkedHashMap<>();
        calendar.put("available", CalendarHelper.hasCalendarPermissions(activity));
        data.put("calendar", calendar);
        return data;
    }

    /** 当前会话身份与角色权限，供导航和入口显隐使用。 */
    private static Map<String, Object> userPayload(Activity activity) {
        AuthManager auth = AuthManager.getInstance();
        boolean loggedIn = auth.isLoggedIn();
        String username = loggedIn ? safe(auth.getCurrentUsername()) : "";
        UserProfileStore.Profile stored = loggedIn ? UserProfileStore.get(activity, username) : null;
        AdminUser record = loggedIn ? findUserByNickname(username) : null;

        Map<String, Object> can = new LinkedHashMap<>();
        can.put("register", auth.canRegisterForExhibitions());
        can.put("profile", auth.canAccessProfile());
        can.put("exhibitor", auth.canAccessExhibitor());
        can.put("admin", auth.canAccessAdmin());

        Map<String, Object> user = new LinkedHashMap<>();
        user.put("loggedIn", loggedIn);
        user.put("guest", auth.isGuest());
        user.put("username", username);
        user.put("nickname", stored != null && !stored.nickname.isEmpty() ? stored.nickname : username);
        user.put("email", stored != null && !stored.email.isEmpty() ? stored.email
                : safe(auth.getCurrentUserEmail()));
        user.put("bio", stored == null ? "" : stored.bio);
        user.put("contact", stored == null ? "" : stored.contact);
        user.put("socialMedia", stored == null ? "" : stored.socialMedia);
        user.put("showRegistrations", stored != null && stored.showRegistrations);
        user.put("role", roleKey(auth));
        user.put("roleLabel", roleLabel(auth));
        user.put("status", record == null ? "" : safe(record.getStatus()));
        user.put("lastLoginTime", record == null ? "" : safe(record.getLastLoginTime()));
        user.put("can", can);
        return user;
    }

    private static String roleKey(AuthManager auth) {
        if (auth.isAdmin()) {
            return "admin";
        }
        if (auth.isExhibitor()) {
            return "exhibitor";
        }
        return auth.isLoggedIn() ? "user" : "guest";
    }

    private static String roleLabel(AuthManager auth) {
        if (auth.isAdmin()) {
            return "管理员";
        }
        if (auth.isExhibitor()) {
            return "展商";
        }
        return auth.isLoggedIn() ? "普通用户" : "访客";
    }

    private static Map<String, Object> themePayload(Activity activity) {
        List<String> hex = new ArrayList<>();
        for (int color : AppSettings.getAccentColors()) {
            hex.add(String.format(java.util.Locale.US, "#%06X", 0xFFFFFF & color));
        }
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("index", AppSettings.getThemeIndex(activity));
        theme.put("colors", hex);
        return theme;
    }

    private static Map<String, Object> capabilities(Activity activity) {
        Map<String, Object> caps = new LinkedHashMap<>();
        caps.put("calendar", CalendarHelper.hasCalendarPermissions(activity));
        caps.put("notifications", NotificationHelper.getInstance(activity).hasNotificationPermission());
        caps.put("richText", true);
        caps.put("export", true);
        return caps;
    }

    private static Map<String, Object> reviewPolicy(Activity activity) {
        Map<String, Object> review = new LinkedHashMap<>();
        review.put("canRevise", AppSettings.canReviseReviewedRegistration(activity));
        review.put("statuses", Arrays.asList(RegistrationReviewStore.STATUS_PENDING,
                RegistrationReviewStore.STATUS_APPROVED, RegistrationReviewStore.STATUS_REJECTED));
        return review;
    }

    private static Map<String, Object> mediaLimits(Activity activity) {
        Map<String, Object> media = new LinkedHashMap<>();
        media.put("imageCount", AppSettings.getMediaImageLimit(activity));
        media.put("imageSizeMb", AppSettings.getMediaImageSizeMb(activity));
        media.put("videoCount", AppSettings.getMediaVideoLimit(activity));
        return media;
    }

    private static Map<String, Object> announcement(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", AppSettings.isAnnouncementEnabled(activity));
        data.put("text", AppSettings.getAnnouncement(activity));
        return data;
    }

    // ── 认证与个人资料 ─────────────────────────────────────────

    private static Map<String, Object> login(Activity activity, Map<String, Object> payload) {
        String error = AuthManager.getInstance().login(WebAppBridge.text(payload, "username", ""),
                WebAppBridge.text(payload, "password", ""));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error == null);
        result.put("error", error == null ? "" : error);
        result.put("user", userPayload(activity));
        return result;
    }

    private static Map<String, Object> register(Activity activity, Map<String, Object> payload) {
        String username = WebAppBridge.text(payload, "username", "");
        String password = WebAppBridge.text(payload, "password", "");
        String confirm = WebAppBridge.text(payload, "confirmPassword", "");
        String email = WebAppBridge.text(payload, "email", "");
        Map<String, Object> result = new LinkedHashMap<>();
        if (!confirm.isEmpty() && !confirm.equals(password)) {
            result.put("ok", false);
            result.put("error", "两次输入的密码不一致");
            result.put("user", userPayload(activity));
            return result;
        }
        String error = AuthManager.getInstance().register(username, password, email);
        if (error == null) {
            UserProfileStore.save(activity, username.trim().toLowerCase(), username.trim(), email, "",
                    "", "", false);
        }
        result.put("ok", error == null);
        result.put("error", error == null ? "" : error);
        result.put("user", userPayload(activity));
        return result;
    }

    private static Map<String, Object> saveProfile(Activity activity, Map<String, Object> payload) {
        AuthManager auth = AuthManager.getInstance();
        String nickname = WebAppBridge.text(payload, "nickname", "").trim();
        String email = WebAppBridge.text(payload, "email", "").trim();
        String bio = WebAppBridge.text(payload, "bio", "").trim();
        String contact = WebAppBridge.text(payload, "contact", "").trim();
        String socialMedia = WebAppBridge.text(payload, "socialMedia", "").trim();
        boolean showRegistrations = WebAppBridge.flag(payload, "showRegistrations", false);
        String error = "";
        if (!auth.isLoggedIn()) {
            error = "请先登录";
        } else if (nickname.isEmpty()) {
            error = "昵称不能为空";
        }
        if (error.isEmpty()) {
            UserProfileStore.save(activity, auth.getCurrentUsername(), nickname, email, bio, contact,
                    socialMedia, showRegistrations);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error.isEmpty());
        result.put("error", error);
        result.put("user", userPayload(activity));
        return result;
    }

    private static Map<String, Object> changePassword(Map<String, Object> payload) {
        String current = WebAppBridge.text(payload, "currentPassword", "");
        String next = WebAppBridge.text(payload, "newPassword", "");
        String confirm = WebAppBridge.text(payload, "confirmPassword", "");
        String error = "";
        if (!AuthManager.getInstance().isLoggedIn()) {
            error = "请先登录";
        } else if (current.isEmpty() || next.isEmpty()) {
            error = "请填写完整密码";
        } else if (next.length() < 4) {
            error = "新密码至少需要 4 个字符";
        } else if (!next.equals(confirm)) {
            error = "两次输入的新密码不一致";
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", error.isEmpty());
        result.put("error", error);
        result.put("note", error.isEmpty() ? "演示环境不会修改密码，仅校验输入" : "");
        return result;
    }

    private static Map<String, Object> notificationPreferences(Activity activity) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exhibitionReminder", helper.isExhibitionReminderEnabled());
        data.put("registrationUpdates", helper.isRegistrationUpdatesEnabled());
        data.put("granted", helper.hasNotificationPermission());
        return data;
    }

    private static void saveNotificationPreferences(Activity activity, Map<String, Object> payload) {
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        helper.setExhibitionReminderEnabled(
                WebAppBridge.flag(payload, "exhibitionReminder", helper.isExhibitionReminderEnabled()));
        helper.setRegistrationUpdatesEnabled(
                WebAppBridge.flag(payload, "registrationUpdates", helper.isRegistrationUpdatesEnabled()));
    }

    private static void requestNotificationPermission(WebAppBridge bridge,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        if (NotificationHelper.getInstance(activity).hasNotificationPermission()
                || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            callback.success(true);
            return;
        }
        int requestCode = bridge.nextRequestCode();
        bridge.registerPermission(requestCode, new WebAppBridge.PendingResult("notify.requestPermission", callback));
        activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, requestCode);
    }

    // ── 展会数据 ───────────────────────────────────────────────

    /** 展会统一结构：数据库记录与首页样例数据合并后的结果。 */
    static Map<String, Object> exhibitionPayload(Activity activity, ExhibitorExhibition exhibition) {
        ExhibitionCatalog.Entry sample = ExhibitionCatalog.findByTitle(exhibition.getTitle());
        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibition.getId());
        String date = ExhibitionConfiguration.displayDate(exhibition.getId(), exhibition.getDay());
        int month = monthOf(date, sample == null ? 6 : sample.month);
        int day = dayOf(date, exhibition.getDay());

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", exhibition.getId());
        item.put("title", exhibition.getTitle());
        item.put("venue", exhibition.getVenue());
        item.put("time", exhibition.getTime());
        item.put("category", safe(exhibition.getCategory()));
        item.put("description", safe(exhibition.getDescription()));
        item.put("status", exhibition.getStatus());
        item.put("mode", registrationMode(exhibition.getStatus()));
        item.put("modeLabel", modeLabel(exhibition.getStatus()));
        item.put("openForRegistration", exhibition.isOpenForRegistration());
        item.put("year", yearOf(date, 2026));
        item.put("month", month);
        item.put("day", day);
        item.put("date", date);
        item.put("dateLabel", month + "月" + day + "日");
        item.put("exhibitor", sample == null ? "主办方" : sample.exhibitor);
        item.put("exhibitorNote", sample == null ? "主办方公开信息" : sample.exhibitorNote);
        item.put("highlights", sample == null ? new ArrayList<String>() : sample.highlights);
        item.put("imageUri", safe(config.imageUri));
        item.put("registrationStart", safe(config.registrationStart));
        item.put("registrationEnd", safe(config.registrationEnd));
        item.put("registrationCount", RegistrationReviewStore.countByStatus(exhibition.getId(), null));
        item.put("fieldCount", config.fields.size());
        return item;
    }

    private static List<Map<String, Object>> exhibitions(Activity activity, Map<String, Object> payload) {
        String query = WebAppBridge.text(payload, "query", "");
        String category = WebAppBridge.text(payload, "category", "");
        List<ExhibitorExhibition> source = query.isEmpty()
                ? ExhibitionManager.listAll()
                : ExhibitionManager.search(query);
        List<Map<String, Object>> items = new ArrayList<>();
        for (ExhibitorExhibition exhibition : source) {
            Map<String, Object> item = exhibitionPayload(activity, exhibition);
            if (!category.isEmpty() && !category.equals(item.get("category"))) {
                continue;
            }
            items.add(item);
        }
        return items;
    }

    private static Map<String, Object> findExhibition(Activity activity, String id) {
        ExhibitorExhibition exhibition = ExhibitionManager.findById(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (exhibition == null) {
            result.put("found", false);
            result.put("error", "展会不存在或已删除");
            return result;
        }
        result.put("found", true);
        result.put("exhibition", exhibitionPayload(activity, exhibition));
        result.put("fields", fieldsPayload(id));
        return result;
    }

    private static Map<String, Object> monthPayload(Activity activity, Map<String, Object> payload) {
        int year = WebAppBridge.number(payload, "year", 2026);
        int month = WebAppBridge.number(payload, "month", 6);
        int selectedDay = WebAppBridge.number(payload, "day", 0);
        List<Map<String, Object>> all = exhibitions(activity, new LinkedHashMap<String, Object>());

        // 请求的月份没有展会时落到最早有展会的月份，避免首页首次进入是空列表。
        List<int[]> months = new ArrayList<>();
        for (Map<String, Object> item : all) {
            int itemYear = ((Number) item.get("year")).intValue();
            int itemMonth = ((Number) item.get("month")).intValue();
            boolean known = false;
            for (int[] entry : months) {
                if (entry[0] == itemYear && entry[1] == itemMonth) {
                    known = true;
                    break;
                }
            }
            if (!known) {
                months.add(new int[] { itemYear, itemMonth });
            }
        }
        boolean matched = false;
        for (Map<String, Object> item : all) {
            if (((Number) item.get("year")).intValue() == year
                    && ((Number) item.get("month")).intValue() == month) {
                matched = true;
                break;
            }
        }
        if (!matched && !months.isEmpty()) {
            year = months.get(0)[0];
            month = months.get(0)[1];
            selectedDay = 0;
        }

        List<Map<String, Object>> days = new ArrayList<>();
        List<Map<String, Object>> selected = new ArrayList<>();
        for (Map<String, Object> item : all) {
            if (((Number) item.get("year")).intValue() != year
                    || ((Number) item.get("month")).intValue() != month) {
                continue;
            }
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("id", item.get("id"));
            summary.put("day", item.get("day"));
            summary.put("title", item.get("title"));
            summary.put("time", item.get("time"));
            summary.put("venue", item.get("venue"));
            summary.put("status", item.get("status"));
            summary.put("modeLabel", item.get("modeLabel"));
            summary.put("openForRegistration", item.get("openForRegistration"));
            summary.put("imageUri", item.get("imageUri"));
            summary.put("category", item.get("category"));
            days.add(summary);
            if (selectedDay <= 0 || Integer.valueOf(selectedDay).equals(item.get("day"))) {
                selected.add(summary);
            }
        }
        if (selectedDay <= 0 && !days.isEmpty()) {
            Integer first = (Integer) days.get(0).get("day");
            selectedDay = first == null ? 0 : first;
            selected.clear();
            for (Map<String, Object> item : days) {
                if (Integer.valueOf(selectedDay).equals(item.get("day"))) {
                    selected.add(item);
                }
            }
        }
        List<Integer> eventDays = new ArrayList<>();
        for (Map<String, Object> item : days) {
            Integer day = (Integer) item.get("day");
            if (day != null && !eventDays.contains(day)) {
                eventDays.add(day);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("year", year);
        result.put("month", month);
        result.put("day", selectedDay);
        result.put("monthLabel", year + " 年 " + month + " 月");
        result.put("eventDays", eventDays);
        result.put("exhibitions", days);
        result.put("selected", selected);
        return result;
    }

    private static Map<String, Object> saveExhibition(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String title = WebAppBridge.text(payload, "title", "").trim();
        String venue = WebAppBridge.text(payload, "venue", "").trim();
        String time = WebAppBridge.text(payload, "time", "").trim();
        String status = WebAppBridge.text(payload, "status", ExhibitorExhibition.STATUS_OPEN);
        String description = WebAppBridge.text(payload, "description", "");
        String category = WebAppBridge.text(payload, "category", "");
        String date = WebAppBridge.text(payload, "date", "");
        String registrationStart = WebAppBridge.text(payload, "registrationStart", "");
        String registrationEnd = WebAppBridge.text(payload, "registrationEnd", "");
        int day = dayOf(date, WebAppBridge.number(payload, "day", 1));

        Map<String, Object> result = new LinkedHashMap<>();
        if (title.isEmpty()) {
            result.put("ok", false);
            result.put("error", "展会名称不能为空");
            return result;
        }
        if (day <= 0) {
            result.put("ok", false);
            result.put("error", "请选择展会日期");
            return result;
        }

        ExhibitorExhibition saved;
        if (id.isEmpty()) {
            saved = ExhibitionManager.add(day, title, venue, time, status, description, category);
        } else {
            boolean updated = ExhibitionManager.update(id, day, title, venue, time, status, description, category);
            saved = updated ? ExhibitionManager.findById(id) : null;
        }
        if (saved == null) {
            result.put("ok", false);
            result.put("error", "保存失败，请稍后重试");
            return result;
        }

        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(saved.getId());
        ExhibitionConfiguration.save(saved.getId(), date.isEmpty() ? config.exhibitionDate : date,
                registrationStart.isEmpty() ? config.registrationStart : registrationStart,
                registrationEnd.isEmpty() ? config.registrationEnd : registrationEnd,
                WebAppBridge.text(payload, "imageUri", config.imageUri),
                config.fields);
        saveExhibitionFields(saved.getId(), payload);

        result.put("ok", true);
        result.put("error", "");
        result.put("exhibition", exhibitionPayload(activity, saved));
        return result;
    }

    /** 表单携带的报名收集项，缺省时保留原配置。 */
    private static void saveExhibitionFields(String exhibitionId, Map<String, Object> payload) {
        List<Object> rawFields = WebAppBridge.list(payload, "fields");
        if (rawFields.isEmpty()) {
            return;
        }
        List<RegistrationField> fields = new ArrayList<>();
        for (Object raw : rawFields) {
            if (!(raw instanceof Map)) {
                continue;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> item = (Map<String, Object>) raw;
            String title = WebAppBridge.text(item, "title", "").trim();
            if (title.isEmpty()) {
                continue;
            }
            fields.add(new RegistrationField(title, WebAppBridge.text(item, "type", RegistrationField.TYPE_TEXT),
                    WebAppBridge.flag(item, "required", false), WebAppBridge.text(item, "options", "")));
        }
        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibitionId);
        ExhibitionConfiguration.save(exhibitionId, config.exhibitionDate, config.registrationStart,
                config.registrationEnd, config.imageUri, fields);
    }

    private static List<Map<String, Object>> fieldsPayload(String exhibitionId) {
        List<RegistrationField> fields = ExhibitionConfiguration.get(exhibitionId).fields;
        return fields.isEmpty() ? defaultFields() : fieldPayloads(fields);
    }

    /** 展会未配置报名项时，按 newUI 报名页的默认字段渲染。 */
    private static List<Map<String, Object>> defaultFields() {
        List<Map<String, Object>> fields = new ArrayList<>();
        fields.add(field("姓名 / 公司名称", RegistrationField.TYPE_TEXT, true, ""));
        fields.add(field("参观身份", RegistrationField.TYPE_SINGLE, true, "专业观众,采购负责人,媒体伙伴"));
        fields.add(field("报名需求", RegistrationField.TYPE_MULTI, false, "希望安排展商洽谈,开展前一天提醒"));
        return fields;
    }

    private static List<Map<String, Object>> fieldPayloads(List<RegistrationField> fields) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (RegistrationField item : fields) {
            result.add(field(item.getTitle(), item.getType(), item.isRequired(), item.getOptions()));
        }
        return result;
    }

    private static Map<String, Object> field(String title, String type, boolean required, String options) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("title", title);
        field.put("type", type);
        field.put("required", required);
        field.put("options", options == null ? "" : options);
        return field;
    }

    private static Map<String, Object> saveFields(String exhibitionId, Map<String, Object> payload) {
        saveExhibitionFields(exhibitionId, payload);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fields", fieldsPayload(exhibitionId));
        return result;
    }

    // ── 报名记录 ───────────────────────────────────────────────

    /**
     * 报名状态文字。
     * <p>
     * SQLite 里的 Registration 只保存 PENDING / CANCELLED，审核结果记录在
     * {@link RegistrationReviewStore}，因此优先取审核记录里的状态，前端与展商后台保持一致。
     */
    private static String registrationStatusLabel(Registration registration) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(registration.getId());
        if (record != null && record.status != null && !record.status.isEmpty()) {
            return record.status;
        }
        return registration.getStatus() == Registration.Status.CANCELLED ? "已撤销" : "待审核";
    }

    private static Map<String, Object> registrationPayload(Registration registration) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", registration.getId());
        item.put("exhibitionTitle", registration.getExhibitionTitle());
        item.put("exhibitionDay", registration.getExhibitionDay());
        item.put("exhibitionTime", safe(registration.getExhibitionTime()));
        item.put("exhibitionVenue", safe(registration.getExhibitionVenue()));
        item.put("visitorName", registration.getVisitorName());
        item.put("visitorType", safe(registration.getVisitorType()));
        item.put("answers", safe(registration.getNeedsSummary()));
        item.put("status", registration.getStatus().name());
        item.put("statusLabel", registrationStatusLabel(registration));
        return item;
    }

    private static List<Map<String, Object>> myRegistrations(Activity activity) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Registration registration : new RegistrationManager().list()) {
            result.add(registrationPayload(registration));
        }
        return result;
    }

    private static Map<String, Object> findRegistration(Activity activity, String id) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Registration registration : new RegistrationManager().list()) {
            if (registration.getId().equals(id)) {
                result.put("found", true);
                result.put("registration", registrationPayload(registration));
                return result;
            }
        }
        result.put("found", false);
        result.put("error", "报名记录不存在");
        return result;
    }

    private static Map<String, Object> submitRegistration(Activity activity, Map<String, Object> payload) {
        String exhibitionId = WebAppBridge.text(payload, "exhibitionId", "");
        String title = WebAppBridge.text(payload, "title", "");
        String venue = WebAppBridge.text(payload, "venue", "");
        String time = WebAppBridge.text(payload, "time", "");
        int day = WebAppBridge.number(payload, "day", 1);
        String visitorName = WebAppBridge.text(payload, "visitorName", "");
        String visitorType = WebAppBridge.text(payload, "visitorType", "自定义报名");
        String answers = WebAppBridge.text(payload, "answers", "");

        Map<String, Object> result = new LinkedHashMap<>();
        AuthManager auth = AuthManager.getInstance();
        if (!auth.canRegisterForExhibitions()) {
            result.put("ok", false);
            result.put("error", "请先登录后再报名");
            return result;
        }
        if (visitorName.isEmpty()) {
            visitorName = safe(auth.getCurrentUsername());
            if (visitorName.isEmpty()) {
                visitorName = "报名用户";
            }
        }
        RegistrationManager manager = new RegistrationManager();
        if (manager.hasActiveRegistration(title)) {
            result.put("ok", false);
            result.put("error", "已提交过该展会的报名");
            return result;
        }
        Registration registration = manager.submit(title, day, time, venue, visitorName, visitorType, answers);
        if (registration == null) {
            result.put("ok", false);
            result.put("error", "提交失败，请稍后重试");
            return result;
        }
        RegistrationReviewStore.add(exhibitionId, visitorName, answers);
        NotificationHelper.getInstance(activity).sendRegistrationConfirmation(title, visitorName);
        result.put("ok", true);
        result.put("error", "");
        result.put("registration", registrationPayload(registration));
        return result;
    }

    private static Map<String, Object> cancelRegistration(Activity activity, String id) {
        Map<String, Object> result = new LinkedHashMap<>();
        RegistrationManager manager = new RegistrationManager();
        String title = "";
        String visitor = "";
        for (Registration registration : manager.list()) {
            if (registration.getId().equals(id)) {
                title = registration.getExhibitionTitle();
                visitor = registration.getVisitorName();
                break;
            }
        }
        boolean cancelled = manager.cancel(id);
        if (cancelled) {
            RegistrationReviewStore.updateStatus(id, RegistrationReviewStore.STATUS_CANCELLED);
            NotificationHelper.getInstance(activity).sendRegistrationStatusNotification(title, visitor,
                    RegistrationReviewStore.STATUS_CANCELLED);
        }
        result.put("ok", cancelled);
        result.put("error", cancelled ? "" : "撤销失败，请稍后重试");
        return result;
    }

    // ── 报名审核 ───────────────────────────────────────────────

    private static Map<String, Object> reviewList(Map<String, Object> payload) {
        String exhibitionId = WebAppBridge.text(payload, "exhibitionId", "");
        String status = WebAppBridge.text(payload, "status", "全部");
        RegistrationReviewStore.ensureSeeded(exhibitionId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (RegistrationReviewStore.Record record : RegistrationReviewStore.listByExhibition(exhibitionId)) {
            if (!"全部".equals(status) && !status.isEmpty() && !status.equals(record.status)) {
                continue;
            }
            items.add(reviewPayload(record));
        }
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("total", RegistrationReviewStore.countByStatus(exhibitionId, null));
        counts.put(RegistrationReviewStore.STATUS_PENDING,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_PENDING));
        counts.put(RegistrationReviewStore.STATUS_APPROVED,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_APPROVED));
        counts.put(RegistrationReviewStore.STATUS_REJECTED,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_REJECTED));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exhibitionId", exhibitionId);
        result.put("status", status);
        result.put("records", items);
        result.put("counts", counts);
        return result;
    }

    private static Map<String, Object> reviewPayload(RegistrationReviewStore.Record record) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", record.id);
        item.put("exhibitionId", record.exhibitionId);
        item.put("visitorName", record.visitorName);
        item.put("registrationTime", record.registrationTime);
        item.put("answers", record.formAnswers == null ? "" : record.formAnswers);
        item.put("summary", summarize(record.formAnswers));
        item.put("status", record.status);
        return item;
    }

    private static Map<String, Object> reviewDetail(String id) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (record == null) {
            result.put("found", false);
            result.put("error", "报名记录不存在");
            return result;
        }
        result.put("found", true);
        result.put("record", reviewPayload(record));
        return result;
    }

    private static Map<String, Object> updateReviewStatus(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String status = WebAppBridge.text(payload, "status", "");
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (record == null) {
            result.put("ok", false);
            result.put("error", "报名记录不存在");
            return result;
        }
        boolean revisable = RegistrationReviewStore.STATUS_PENDING.equals(record.status)
                || AppSettings.canReviseReviewedRegistration(activity);
        if (!revisable) {
            result.put("ok", false);
            result.put("error", "该报名已审核，管理员未开启允许重新审核");
            return result;
        }
        RegistrationReviewStore.updateStatus(id, status);
        DatabaseHelper database = DatabaseHelper.getInstance();
        if (database != null) {
            database.updateRegistrationStatus(id, status);
        }
        NotificationHelper.getInstance(activity).sendRegistrationStatusNotification(
                exhibitionTitleOf(record.exhibitionId), record.visitorName, status);
        result.put("ok", true);
        result.put("error", "");
        result.put("record", reviewPayload(RegistrationReviewStore.find(id)));
        return result;
    }

    private static String exhibitionTitleOf(String exhibitionId) {
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        return exhibition == null ? "展会报名" : exhibition.getTitle();
    }

    private static String summarize(String answers) {
        if (answers == null || answers.isEmpty()) {
            return "未收集额外信息";
        }
        String flat = answers.replace('\n', ' ').replace('\r', ' ').trim();
        return flat.length() > 46 ? flat.substring(0, 46) + "…" : flat;
    }

    // ── 用户管理 ───────────────────────────────────────────────

    private static List<Map<String, Object>> users(Map<String, Object> payload) {
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

    private static Map<String, Object> adminUserPayload(AdminUser user) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", user.getId());
        item.put("nickname", safe(user.getNickname()));
        item.put("email", safe(user.getEmail()));
        item.put("status", safe(user.getStatus()));
        item.put("registrationTime", safe(user.getRegistrationTime()));
        item.put("lastLoginTime", safe(user.getLastLoginTime()));
        item.put("role", roleFromNickname(user.getNickname()));
        return item;
    }

    /** 演示数据没有独立角色字段，按约定昵称推断，与内置账号一致。 */
    private static String roleFromNickname(String nickname) {
        if ("demo".equalsIgnoreCase(nickname)) {
            return "管理员";
        }
        if ("exhibitor".equalsIgnoreCase(nickname)) {
            return "展商";
        }
        return "普通用户";
    }

    private static Map<String, Object> findUser(String id) {
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

    private static AdminUser findUserByNickname(String nickname) {
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

    private static Map<String, Object> publicProfile(Activity activity, Map<String, Object> payload) {
        String nickname = WebAppBridge.text(payload, "nickname", "");
        String userId = WebAppBridge.text(payload, "userId", "");
        AdminUser user = userId.isEmpty() ? findUserByNickname(nickname) : AdminUserManager.findById(userId);
        Map<String, Object> profile = new LinkedHashMap<>();
        if (user == null) {
            profile.put("found", false);
            profile.put("error", "用户不存在或未公开");
            return profile;
        }
        UserProfileStore.Profile stored = UserProfileStore.get(activity, user.getNickname());
        profile.put("found", true);
        profile.put("nickname", safe(user.getNickname()));
        profile.put("role", roleFromNickname(user.getNickname()));
        profile.put("bio", stored == null ? "" : stored.bio);
        profile.put("contact", stored == null ? "" : stored.contact);
        profile.put("socialMedia", stored == null ? "" : stored.socialMedia);
        profile.put("showRegistrations", stored != null && stored.showRegistrations);

        List<Map<String, Object>> registrations = new ArrayList<>();
        if (stored != null && stored.showRegistrations) {
            for (Map<String, Object> registration : myRegistrations(activity)) {
                if (safe(user.getNickname()).equals(registration.get("visitorName"))) {
                    registrations.add(registration);
                }
            }
        }
        profile.put("registrations", registrations);
        return profile;
    }

    // ── 搜索 ───────────────────────────────────────────────────

    private static Map<String, Object> search(Activity activity, String query) {
        List<Map<String, Object>> exhibitions = new ArrayList<>();
        List<Map<String, Object>> people = new ArrayList<>();
        if (!query.trim().isEmpty()) {
            for (ExhibitorExhibition exhibition : ExhibitionManager.search(query)) {
                exhibitions.add(exhibitionPayload(activity, exhibition));
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

    // ── 系统设置 ───────────────────────────────────────────────

    private static Map<String, Object> settings(Activity activity) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("theme", themePayload(activity));
        data.put("announcement", announcement(activity));
        data.put("categories", AppSettings.getCategories(activity));
        data.put("review", reviewPolicy(activity));
        data.put("media", mediaLimits(activity));
        data.put("notify", notificationPreferences(activity));
        return data;
    }

    private static Map<String, Object> saveSettings(Activity activity, Map<String, Object> payload) {
        AppSettings.setThemeIndex(activity,
                WebAppBridge.number(payload, "themeIndex", AppSettings.getThemeIndex(activity)));
        AppSettings.saveAnnouncement(activity, WebAppBridge.text(payload, "announcement", ""),
                WebAppBridge.flag(payload, "announcementEnabled", false));

        List<Object> rawCategories = WebAppBridge.list(payload, "categories");
        if (!rawCategories.isEmpty()) {
            List<String> categories = new ArrayList<>();
            for (Object raw : rawCategories) {
                String value = String.valueOf(raw).trim();
                if (!value.isEmpty()) {
                    categories.add(value);
                }
            }
            if (!categories.isEmpty()) {
                AppSettings.saveCategories(activity, categories);
            }
        }
        AppSettings.setCanReviseReviewedRegistration(activity,
                WebAppBridge.flag(payload, "canRevise", AppSettings.canReviseReviewedRegistration(activity)));
        AppSettings.saveMediaLimits(activity,
                WebAppBridge.number(payload, "imageCount", AppSettings.getMediaImageLimit(activity)),
                WebAppBridge.number(payload, "imageSizeMb", AppSettings.getMediaImageSizeMb(activity)),
                WebAppBridge.number(payload, "videoCount", AppSettings.getMediaVideoLimit(activity)));
        if (payload.containsKey("notify")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> notify = payload.get("notify") instanceof Map
                    ? (Map<String, Object>) payload.get("notify")
                    : new LinkedHashMap<String, Object>();
            saveNotificationPreferences(activity, notify);
        }
        AppSettings.applyWindowColors(activity);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("settings", settings(activity));
        return result;
    }

    // ── 系统日历 ───────────────────────────────────────────────

    private static Map<String, Object> calendarStatus(Activity activity, Map<String, Object> payload) {
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        data.put("inCalendar", !title.isEmpty() && CalendarHelper.isInCalendar(activity, title, day));
        return data;
    }

    /** 加入或移出系统日历；缺少权限时先申请，授权后继续执行。 */
    private static void toggleCalendar(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        boolean inCalendar = CalendarHelper.isInCalendar(activity, title, day);

        if (CalendarHelper.hasCalendarPermissions(activity)) {
            callback.success(applyCalendarChange(activity, payload, inCalendar));
            return;
        }
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("calendar.toggle", callback);
        pending.context.putAll(payload);
        pending.context.put("inCalendar", inCalendar);
        bridge.registerPermission(requestCode, pending);
        activity.requestPermissions(
                new String[] { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR },
                requestCode);
    }

    private static Map<String, Object> applyCalendarChange(Activity activity, Map<String, Object> payload,
            boolean inCalendar) {
        String title = WebAppBridge.text(payload, "title", "");
        int day = WebAppBridge.number(payload, "day", 1);
        if (inCalendar) {
            CalendarHelper.removeFromCalendar(activity, title, day);
        } else {
            CalendarHelper.addToCalendar(activity, title, WebAppBridge.text(payload, "venue", ""), day,
                    WebAppBridge.text(payload, "time", ""), WebAppBridge.text(payload, "description", ""));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("inCalendar", !inCalendar);
        result.put("granted", CalendarHelper.hasCalendarPermissions(activity));
        result.put("message", inCalendar ? "已从系统日历移除" : "已加入系统日历");
        return result;
    }

    // ── 媒体与分享 ─────────────────────────────────────────────

    private static void pickFile(WebAppBridge bridge, String mimeType, String chooserTitle,
            WebAppBridge.ResultCallback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        bridge.startForResult(Intent.createChooser(intent, chooserTitle), bridge.nextRequestCode(),
                new WebAppBridge.PendingResult("media.pick", callback));
    }

    /** 读取图片并转成 data URL，供 WebView 直接展示系统选择器返回的图片。 */
    private static String imageData(Context context, String uri) {
        if (uri == null || uri.isEmpty() || context == null) {
            return "";
        }
        try (InputStream input = context.getContentResolver().openInputStream(Uri.parse(uri))) {
            if (input == null) {
                return "";
            }
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            if (bitmap == null) {
                return "";
            }
            int max = 1080;
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            if (width > max || height > max) {
                float ratio = Math.min(max / (float) width, max / (float) height);
                bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio),
                        Math.round(height * ratio), true);
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output);
            return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } catch (Exception error) {
            Log.w(TAG, "图片读取失败: " + uri, error);
            return "";
        }
    }

    private static void shareText(Activity activity, Map<String, Object> payload) {
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_SUBJECT, WebAppBridge.text(payload, "title", ""));
        share.putExtra(Intent.EXTRA_TEXT, WebAppBridge.text(payload, "text", ""));
        activity.startActivity(Intent.createChooser(share, "分享展会"));
    }

    /** 导出 CSV：交给系统文件选择器写入，避免依赖存储权限。 */
    private static void exportCsv(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String type = WebAppBridge.text(payload, "type", "exhibitions");
        String csv;
        String fileName;
        if ("registrations".equals(type)) {
            csv = ExportManager.exportRegistrations(bridge.activity());
            fileName = "calmobile-registrations.csv";
        } else if ("users".equals(type)) {
            csv = ExportManager.exportUsers(bridge.activity());
            fileName = "calmobile-users.csv";
        } else {
            csv = ExportManager.exportExhibitions(bridge.activity());
            fileName = "calmobile-exhibitions.csv";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending = new WebAppBridge.PendingResult("export.csv", callback);
        pending.context.put("csv", csv);
        pending.context.put("fileName", fileName);
        bridge.startForResult(intent, requestCode, pending);
    }

    private static void toast(Activity activity, String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_SHORT).show();
    }

    // ── 系统界面与权限回调 ─────────────────────────────────────

    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        Activity activity = bridge.activity();
        if (pending.context.containsKey("csv")) {
            writeCsv(activity, pending, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消选择");
            return;
        }
        Uri uri = data.getData();
        String mime = activity.getContentResolver().getType(uri);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("uri", uri.toString());
        result.put("mimeType", mime == null ? "" : mime);
        result.put("dataUrl", mime != null && mime.startsWith("image/")
                ? imageData(activity, uri.toString()) : "");
        pending.callback.success(result);
    }

    private static void writeCsv(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消导出");
            return;
        }
        String csv = String.valueOf(pending.context.get("csv"));
        try (java.io.OutputStream output =
                     activity.getContentResolver().openOutputStream(data.getData())) {
            if (output == null) {
                pending.callback.failure("无法写入所选文件");
                return;
            }
            output.write(csv.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception error) {
            pending.callback.failure("导出失败：" + error.getMessage());
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fileName", String.valueOf(pending.context.get("fileName")));
        result.put("rows", Math.max(0, csv.split("\n").length - 1));
        pending.callback.success(result);
    }

    static void onPermissionResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            boolean granted) {
        Activity activity = bridge.activity();
        if ("calendar.toggle".equals(pending.action)) {
            if (!granted) {
                pending.callback.failure("未获得日历权限，无法写入系统日历");
                return;
            }
            pending.callback.success(applyCalendarChange(activity, pending.context,
                    Boolean.TRUE.equals(pending.context.get("inCalendar"))));
            return;
        }
        pending.callback.success(granted);
    }

    // ── 工具方法 ───────────────────────────────────────────────

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    /** 报名方式：线框的“需审核 / 无需审核 / 仅展示”与现有状态字段的映射。 */
    static String registrationMode(String status) {
        if (ExhibitorExhibition.STATUS_DISPLAY_ONLY.equals(status)) {
            return "display";
        }
        if (ExhibitorExhibition.STATUS_CLOSED.equals(status)) {
            return "closed";
        }
        if (ExhibitorExhibition.STATUS_ENDED.equals(status)) {
            return "ended";
        }
        return "review";
    }

    static String modeLabel(String status) {
        switch (registrationMode(status)) {
            case "display":
                return "仅展示";
            case "closed":
                return "截止报名";
            case "ended":
                return "已结束";
            default:
                return ExhibitorExhibition.STATUS_REVIEW_OPTIONAL.equals(status)
                        ? "报名中 · 无需审核" : "报名中 · 需审核";
        }
    }

    private static int yearOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(0, 4));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static int monthOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(5, 7));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static int dayOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(8, 10));
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
