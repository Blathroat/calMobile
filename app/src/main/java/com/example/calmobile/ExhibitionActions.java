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
 * 展会读写、月视图与报名收集项。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class ExhibitionActions {

    private ExhibitionActions() {
    }

    static Map<String, Object> exhibitionPayload(Activity activity, ExhibitorExhibition exhibition) {
        ExhibitionCatalog.Entry sample = ExhibitionCatalog.findByTitle(exhibition.getTitle());
        ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibition.getId());
        String date = ExhibitionConfiguration.displayDate(exhibition.getId(), exhibition.getDay());
        int month = ActionSupport.monthOf(date, sample == null ? 6 : sample.month);
        int day = ActionSupport.dayOf(date, exhibition.getDay());

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", exhibition.getId());
        item.put("title", exhibition.getTitle());
        item.put("venue", exhibition.getVenue());
        item.put("time", exhibition.getTime());
        item.put("category", ActionSupport.safe(exhibition.getCategory()));
        item.put("description", ActionSupport.safe(exhibition.getDescription()));
        item.put("descriptionFormat", descriptionFormatOf(config, exhibition.getDescription()));
        item.put("status", exhibition.getStatus());
        item.put("mode", ActionSupport.registrationMode(exhibition.getStatus()));
        item.put("modeLabel", ActionSupport.modeLabel(exhibition.getStatus()));
        item.put("openForRegistration", exhibition.isOpenForRegistration());
        item.put("year", ActionSupport.yearOf(date, 2026));
        item.put("month", month);
        item.put("day", day);
        item.put("date", date);
        item.put("dateLabel", month + "月" + day + "日");
        item.put("exhibitor", sample == null ? "主办方" : sample.exhibitor);
        item.put("exhibitorNote", sample == null ? "主办方公开信息" : sample.exhibitorNote);
        item.put("highlights", sample == null ? new ArrayList<String>() : sample.highlights);
        item.put("imageUri", ActionSupport.safe(config.imageUri));
        item.put("registrationStart", ActionSupport.safe(config.registrationStart));
        item.put("registrationEnd", ActionSupport.safe(config.registrationEnd));
        item.put("qrEnabled", config.registrationQrEnabled);
        item.put("registrationCount", RegistrationReviewStore.countByStatus(exhibition.getId(), null));
        item.put("fieldCount", config.fields.size());
        return item;
    }

    static List<Map<String, Object>> exhibitions(Activity activity, Map<String, Object> payload) {
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

    static Map<String, Object> findExhibition(Activity activity, String id) {
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

    static Map<String, Object> monthPayload(Activity activity, Map<String, Object> payload) {
        int year = WebAppBridge.number(payload, "year", 2026);
        int month = WebAppBridge.number(payload, "month", 6);
        int selectedDay = WebAppBridge.number(payload, "day", 0);
        // 用户主动翻月（滑动或箭头）时不再回退到有数据的月份，空月份如实展示。
        boolean explicit = WebAppBridge.flag(payload, "explicit", false);
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
        if (!matched && !months.isEmpty() && !explicit) {
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

    static Map<String, Object> saveExhibition(Activity activity, Map<String, Object> payload) {
        String id = WebAppBridge.text(payload, "id", "");
        String title = WebAppBridge.text(payload, "title", "").trim();
        String venue = WebAppBridge.text(payload, "venue", "").trim();
        String time = WebAppBridge.text(payload, "time", "").trim();
        String status = WebAppBridge.text(payload, "status", ExhibitorExhibition.STATUS_OPEN);
        String description = WebAppBridge.text(payload, "description", "");
        String descriptionFormat = WebAppBridge.text(payload, "descriptionFormat", "md");
        String category = WebAppBridge.text(payload, "category", "");
        String date = WebAppBridge.text(payload, "date", "");
        String registrationStart = WebAppBridge.text(payload, "registrationStart", "");
        String registrationEnd = WebAppBridge.text(payload, "registrationEnd", "");
        int day = ActionSupport.dayOf(date, WebAppBridge.number(payload, "day", 1));

        Map<String, Object> result = new LinkedHashMap<>();
        if (title.isEmpty()) {
            result.put("ok", false);
            result.put("error", "展会名称不能为空");
            return result;
        }
        String lengthError = ProfileActions.validateLength(activity, title, AppSettings.getExhibitionTitleLimit(activity), "展会名称");
        if (lengthError.isEmpty()) {
            lengthError = ProfileActions.validateLength(activity, venue, AppSettings.getExhibitionVenueLimit(activity), "展会地点");
        }
        if (lengthError.isEmpty()) {
            lengthError = ProfileActions.validateLength(activity, category, AppSettings.getCategoryLimit(activity), "展会分类");
        }
        if (!lengthError.isEmpty()) {
            result.put("ok", false);
            result.put("error", lengthError);
            return result;
        }
        if (day <= 0) {
            result.put("ok", false);
            result.put("error", "请选择展会日期");
            return result;
        }
        if (!registrationStart.isEmpty() && !registrationEnd.isEmpty()
                && registrationEnd.compareTo(registrationStart) < 0) {
            result.put("ok", false);
            result.put("error", "报名截止日期不能早于开始日期");
            return result;
        }
        // 长简介里的内联图片改写成本地文件 URL，避免 base64 撑大正文。
        description = MediaActions.inlineDataUrlsToFiles(activity, description);

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
        ExhibitionConfiguration.save(saved.getId(), new ExhibitionConfiguration.Patch()
                .dates(date.isEmpty() ? config.exhibitionDate : date,
                        registrationStart.isEmpty() ? config.registrationStart : registrationStart,
                        registrationEnd.isEmpty() ? config.registrationEnd : registrationEnd)
                .image(WebAppBridge.text(payload, "imageUri", config.imageUri))
                .descriptionFormat(descriptionFormat)
                .fields(config.fields));
        // 报名二维码开关由展会编辑页的“是否启用报名二维码”按钮控制。
        if (payload.containsKey("qrEnabled")) {
            ExhibitionConfiguration.save(saved.getId(), new ExhibitionConfiguration.Patch()
                    .registrationQr(WebAppBridge.flag(payload, "qrEnabled", false)));
        }
        saveExhibitionFields(saved.getId(), payload);

        result.put("ok", true);
        result.put("error", "");
        result.put("exhibition", exhibitionPayload(activity, saved));
        return result;
    }

    static void saveExhibitionFields(String exhibitionId, Map<String, Object> payload) {
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
                    WebAppBridge.flag(item, "required", false), optionsText(item.get("options"))));
        }
        // 收集项只覆盖这一个字段，日期、图片等其它段保持原值。
        ExhibitionConfiguration.save(exhibitionId, new ExhibitionConfiguration.Patch().fields(fields));
    }

    static String optionsText(Object raw) {
        if (raw instanceof List) {
            StringBuilder builder = new StringBuilder();
            for (Object item : (List<?>) raw) {
                String value = String.valueOf(item).trim();
                if (value.isEmpty()) {
                    continue;
                }
                if (builder.length() > 0) {
                    builder.append(',');
                }
                builder.append(value);
            }
            return builder.toString();
        }
        return raw == null ? "" : String.valueOf(raw);
    }

    static List<String> optionsList(String options) {
        List<String> result = new ArrayList<>();
        if (options == null) {
            return result;
        }
        for (String item : options.split(",")) {
            String value = item.trim();
            if (!value.isEmpty()) {
                result.add(value);
            }
        }
        return result;
    }

    static List<Map<String, Object>> fieldsPayload(String exhibitionId) {
        List<RegistrationField> fields = ExhibitionConfiguration.get(exhibitionId).fields;
        return fields.isEmpty() ? defaultFields() : fieldPayloads(fields);
    }

    static List<Map<String, Object>> defaultFields() {
        List<Map<String, Object>> fields = new ArrayList<>();
        fields.add(field("姓名 / 公司名称", RegistrationField.TYPE_TEXT, true, new ArrayList<String>()));
        fields.add(field("参观身份", RegistrationField.TYPE_SINGLE, true,
                Arrays.asList("专业观众", "采购负责人", "媒体伙伴")));
        fields.add(field("报名需求", RegistrationField.TYPE_MULTI, false,
                Arrays.asList("希望安排展商洽谈", "开展前一天提醒")));
        return fields;
    }

    static List<Map<String, Object>> fieldPayloads(List<RegistrationField> fields) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (RegistrationField item : fields) {
            result.add(field(item.getTitle(), item.getType(), item.isRequired(), optionsList(item.getOptions())));
        }
        return result;
    }

    static Map<String, Object> field(String title, String type, boolean required, List<String> options) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("title", title);
        field.put("type", type);
        field.put("required", required);
        field.put("options", options == null ? new ArrayList<String>() : options);
        return field;
    }

    static String descriptionFormatOf(ExhibitionConfiguration.Data config, String description) {
        if ("html".equals(config.descriptionFormat)) {
            return "html";
        }
        String text = description == null ? "" : description.trim();
        if (text.matches("(?s)^\\s*<(p|div|h[1-6]|ul|ol|blockquote|br|strong|em)\\b.*")) {
            return "html";
        }
        return "md";
    }

    static Map<String, Object> saveFields(String exhibitionId, Map<String, Object> payload) {
        saveExhibitionFields(exhibitionId, payload);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fields", fieldsPayload(exhibitionId));
        return result;
    }
    /** 删除展会；归属校验在 ExhibitionManager 内部完成。 */
    static boolean remove(Map<String, Object> payload) {
        return ExhibitionManager.delete(WebAppBridge.text(payload, "id", ""));
    }

    /** 修改报名方式 / 状态。 */
    static boolean updateStatus(Map<String, Object> payload) {
        return ExhibitionManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                WebAppBridge.text(payload, "status", ""));
    }

    /** 展会分类来自服务器设置。 */
    static List<String> categories(Activity activity) {
        return AppSettings.getCategories(activity);
    }
}
