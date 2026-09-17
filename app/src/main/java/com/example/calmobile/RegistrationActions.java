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
 * 报名提交与撤销、报名审核、报名二维码与现场核销。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class RegistrationActions {

    private RegistrationActions() {
    }

    static final String REGISTRATION_CODE_PREFIX = "CALMOBILE-CHECKIN|";

    static String registrationStatusLabel(Registration registration) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(registration.getId());
        if (record != null && record.status != null && !record.status.isEmpty()) {
            return record.status;
        }
        return registration.getStatus() == Registration.Status.CANCELLED ? "已撤销" : "待审核";
    }

    /** 从 YYYY-MM-DD 里取年（offset 0）或月（offset 5）；取不到返回 0。 */
    private static int datePart(String isoDate, int offset) {
        int length = offset == 0 ? 4 : 2;
        if (isoDate == null || isoDate.length() < offset + length) {
            return 0;
        }
        try {
            return Integer.parseInt(isoDate.substring(offset, offset + length));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    static Map<String, Object> registrationPayload(Registration registration) {        Map<String, Object> item = new LinkedHashMap<>();
        String statusLabel = registrationStatusLabel(registration);
        // 报名码与审核记录一一对应，因此从记录里取所属展会，供前端拼二维码内容。
        RegistrationReviewStore.Record review = RegistrationReviewStore.find(registration.getId());
        String exhibitionId = review == null ? "" : ActionSupport.safe(review.exhibitionId);
        item.put("id", registration.getId());
        item.put("exhibitionId", exhibitionId);
        item.put("exhibitionTitle", registration.getExhibitionTitle());
        item.put("exhibitionDay", registration.getExhibitionDay());
        // 展会实际日期：前端按 exhibitionDate 渲染，缺了它就只能拿日号猜月份。
        // 与 HTTP 后端 registrationPayload 的字段保持一致（离线降级时页面不用改）。
        String exhibitionDate = exhibitionId.isEmpty()
                ? "" : ExhibitionConfiguration.displayDate(exhibitionId, registration.getExhibitionDay());
        item.put("exhibitionDate", exhibitionDate);
        item.put("exhibitionYear", datePart(exhibitionDate, 0));
        item.put("exhibitionMonth", datePart(exhibitionDate, 5));
        item.put("exhibitionTime", ActionSupport.safe(registration.getExhibitionTime()));
        item.put("exhibitionVenue", ActionSupport.safe(registration.getExhibitionVenue()));
        item.put("visitorName", registration.getVisitorName());
        item.put("visitorType", ActionSupport.safe(registration.getVisitorType()));
        item.put("answers", ActionSupport.safe(registration.getNeedsSummary()));
        item.put("status", registration.getStatus().name());
        item.put("statusLabel", statusLabel);
        // 只有启用报名二维码、且状态为已通过 / 已参加的报名才展示报名码。
        boolean qrEnabled = !exhibitionId.isEmpty()
                && ExhibitionConfiguration.isRegistrationQrEnabled(exhibitionId);
        boolean checkable = RegistrationReviewStore.STATUS_APPROVED.equals(statusLabel)
                || RegistrationReviewStore.STATUS_ATTENDED.equals(statusLabel);
        item.put("qrEnabled", qrEnabled);
        item.put("checkInCode", qrEnabled && checkable
                ? registrationCode(exhibitionId, registration.getId()) : "");
        return item;
    }

    static List<Map<String, Object>> myRegistrations(Activity activity) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Registration registration : new RegistrationManager().list()) {
            result.add(registrationPayload(registration));
        }
        return result;
    }

    static Map<String, Object> findRegistration(Activity activity, String id) {
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

    static Map<String, Object> submitRegistration(Activity activity, Map<String, Object> payload) {
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
            visitorName = ActionSupport.safe(auth.getCurrentUsername());
            if (visitorName.isEmpty()) {
                visitorName = "报名用户";
            }
        }
        int answerLimit = AppSettings.getAnswerLimit(activity);
        for (String line : answers.split("\n")) {
            int separator = line.indexOf('：');
            String value = (separator >= 0 ? line.substring(separator + 1) : line).trim();
            if (value.length() > answerLimit && !"未填写".equals(value)) {
                result.put("ok", false);
                result.put("error", "报名填写内容最多 " + answerLimit + " 个字符");
                return result;
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
        // 审核记录用报名表自己的 id：核销、撤销都要按同一个 id 更新报名行。
        RegistrationReviewStore.Record record =
                RegistrationReviewStore.add(registration.getId(), exhibitionId, visitorName, answers);
        // “无需审核”的展会提交即视为通过，展商仍可在报名管理中调整结果。
        boolean autoApproved = autoApprove(activity, exhibitionId, record);
        NotificationHelper helper = NotificationHelper.getInstance(activity);
        if (autoApproved) {
            helper.sendRegistrationStatusNotification(title, visitorName, RegistrationReviewStore.STATUS_APPROVED);
        } else {
            helper.sendRegistrationConfirmation(title, visitorName);
        }
        result.put("ok", true);
        result.put("error", "");
        result.put("autoApproved", autoApproved);
        result.put("statusLabel", autoApproved ? RegistrationReviewStore.STATUS_APPROVED
                : RegistrationReviewStore.STATUS_PENDING);
        result.put("registration", registrationPayload(registration));
        return result;
    }

    static boolean autoApprove(Activity activity, String exhibitionId,
            RegistrationReviewStore.Record record) {
        if (record == null) {
            return false;
        }
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        if (exhibition == null || !ExhibitorExhibition.STATUS_REVIEW_OPTIONAL.equals(exhibition.getStatus())) {
            return false;
        }
        RegistrationReviewStore.updateStatus(record.id, RegistrationReviewStore.STATUS_APPROVED);
        updateRegistrationRow(record, RegistrationReviewStore.STATUS_APPROVED);
        return true;
    }

    /**
     * 把审核状态写回报名表。
     * <p>
     * 示例记录（{@code demo-} 前缀）在报名表里没有对应行，跳过即可——它们本来就是
     * 为了让展商后台一进去有内容可看而造的，不参与真实报名状态的流转。
     */
    static void updateRegistrationRow(RegistrationReviewStore.Record record, String status) {
        if (record == null || record.demo) {
            return;
        }
        DatabaseHelper database = DatabaseHelper.getInstance();
        if (database != null) {
            database.updateRegistrationStatus(record.id, status);
        }
    }

    static Map<String, Object> cancelRegistration(Activity activity, String id) {
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

    static Map<String, Object> reviewList(Map<String, Object> payload) {
        String exhibitionId = WebAppBridge.text(payload, "exhibitionId", "");
        String status = WebAppBridge.text(payload, "status", "全部");
        RegistrationReviewStore.seedDemoIfEmpty(exhibitionId);
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
        counts.put(RegistrationReviewStore.STATUS_ATTENDED,
                RegistrationReviewStore.countByStatus(exhibitionId, RegistrationReviewStore.STATUS_ATTENDED));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exhibitionId", exhibitionId);
        result.put("status", status);
        result.put("records", items);
        result.put("counts", counts);
        return result;
    }

    static Map<String, Object> reviewPayload(RegistrationReviewStore.Record record) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", record.id);
        item.put("exhibitionId", record.exhibitionId);
        item.put("visitorName", record.visitorName);
        item.put("registrationTime", record.registrationTime);
        item.put("answers", record.formAnswers == null ? "" : record.formAnswers);
        item.put("summary", ActionSupport.summarize(record.formAnswers));
        item.put("status", record.status);
        return item;
    }

    static Map<String, Object> reviewDetail(String id) {
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

    static Map<String, Object> updateReviewStatus(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String status = WebAppBridge.text(payload, "status", "");
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        Map<String, Object> result = new LinkedHashMap<>();
        if (record == null) {
            result.put("ok", false);
            result.put("error", "报名记录不存在");
            return result;
        }
        // 管理员不受“允许修改已通过或已拒绝的报名”开关限制：管理后台的查看报名
        // 始终可以切换报名人状态，该开关只约束展商。
        boolean revisable = RegistrationReviewStore.STATUS_PENDING.equals(record.status)
                || AuthManager.getInstance().isAdmin()
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

    static String exhibitionTitleOf(String exhibitionId) {
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        return exhibition == null ? "展会报名" : exhibition.getTitle();
    }

    static String registrationCode(String exhibitionId, String recordId) {
        return REGISTRATION_CODE_PREFIX + ActionSupport.safe(exhibitionId) + "|" + ActionSupport.safe(recordId);
    }

    static String[] parseCheckInCode(String raw) {
        String text = ActionSupport.safe(raw).trim();
        if (text.isEmpty()) {
            return null;
        }
        if (text.startsWith(REGISTRATION_CODE_PREFIX)) {
            String body = text.substring(REGISTRATION_CODE_PREFIX.length());
            int separator = body.indexOf('|');
            if (separator <= 0) {
                return null;
            }
            String exhibitionId = body.substring(0, separator).trim();
            String recordId = body.substring(separator + 1).trim();
            if (recordId.isEmpty()) {
                return null;
            }
            return new String[] { exhibitionId, recordId };
        }
        // 容错：直接扫到记录 id 时也能核销，展会从记录里反查。
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(text);
        if (record == null) {
            return null;
        }
        return new String[] { ActionSupport.safe(record.exhibitionId), record.id };
    }

    static Map<String, Object> checkIn(Activity activity, Map<String, Object> payload) {
        Map<String, Object> result = new LinkedHashMap<>();
        AuthManager auth = AuthManager.getInstance();
        if (!auth.isLoggedIn()) {
            result.put("ok", false);
            result.put("error", "请先登录展商账号");
            return result;
        }
        String raw = WebAppBridge.text(payload, "code", "");
        String[] parsed = parseCheckInCode(raw);
        if (parsed == null) {
            result.put("ok", false);
            result.put("error", "无法识别的报名码，请扫描报名详情里的二维码");
            return result;
        }
        String exhibitionId = parsed[0];
        String recordId = parsed[1];
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(recordId);
        if (record == null) {
            result.put("ok", false);
            result.put("error", "报名记录不存在，可能已被撤销");
            return result;
        }
        if (!exhibitionId.isEmpty() && !exhibitionId.equals(record.exhibitionId)) {
            result.put("ok", false);
            result.put("error", "报名码与展会不匹配");
            return result;
        }
        if (!canCheckInExhibition(auth, record.exhibitionId)) {
            result.put("ok", false);
            result.put("error", "该报名不属于你举办的展会");
            return result;
        }
        // 核销成功后的完整信息，扫码页直接展示，避免再查一次。
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("recordId", record.id);
        info.put("visitorName", record.visitorName);
        info.put("exhibitionId", ActionSupport.safe(record.exhibitionId));
        info.put("exhibitionTitle", exhibitionTitleOf(record.exhibitionId));
        info.put("registrationTime", record.registrationTime);
        info.put("answers", ActionSupport.summarize(record.formAnswers));

        if (RegistrationReviewStore.STATUS_ATTENDED.equals(record.status)) {
            result.put("ok", false);
            result.put("duplicated", true);
            result.put("error", record.visitorName + " 的报名码已经核销过了");
            result.put("record", info);
            result.put("status", record.status);
            return result;
        }
        if (!RegistrationReviewStore.STATUS_APPROVED.equals(record.status)) {
            result.put("ok", false);
            result.put("error", "当前状态为「" + ActionSupport.safe(record.status) + "」，只有已通过的报名可以核销");
            result.put("record", info);
            result.put("status", record.status);
            return result;
        }
        RegistrationReviewStore.updateStatus(record.id, RegistrationReviewStore.STATUS_ATTENDED);
        updateRegistrationRow(record, RegistrationReviewStore.STATUS_ATTENDED);
        NotificationHelper.getInstance(activity).sendRegistrationStatusNotification(
                exhibitionTitleOf(record.exhibitionId), record.visitorName,
                RegistrationReviewStore.STATUS_ATTENDED);
        result.put("ok", true);
        result.put("error", "");
        result.put("duplicated", false);
        result.put("status", RegistrationReviewStore.STATUS_ATTENDED);
        result.put("message", "已核销 " + record.visitorName + " 的报名");
        result.put("record", info);
        return result;
    }

    static boolean canCheckInExhibition(AuthManager auth, String exhibitionId) {
        if (auth.isAdmin()) {
            return true;
        }
        if (!auth.canAccessExhibitor()) {
            return false;
        }
        return ExhibitionManager.findById(exhibitionId) != null;
    }}
