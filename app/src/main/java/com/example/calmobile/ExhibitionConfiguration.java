package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/** 保存不影响旧版数据库字段的展会扩展信息。 */
public final class ExhibitionConfiguration {
    private static final java.util.Map<String, Data> DATA = new java.util.HashMap<>();

    public static final class Data {
        String exhibitionDate = "2026-06-01";
        String registrationStart = "2026-05-01";
        String registrationEnd = "2026-05-31";
        String imageUri = "";
        final List<RegistrationField> fields = new ArrayList<>();
    }

    private ExhibitionConfiguration() { }

    public static Data get(String exhibitionId) {
        Data data = DATA.get(exhibitionId);
        if (data == null) {
            data = new Data();
            DATA.put(exhibitionId, data);
        }
        return data;
    }

    public static String displayDate(String exhibitionId, int fallbackDay) {
        String date = get(exhibitionId).exhibitionDate;
        if (date == null || date.isEmpty() || "2026-06-01".equals(date)) {
            return String.format(java.util.Locale.CHINA, "2026-06-%02d", fallbackDay);
        }
        return date;
    }

    public static void save(String exhibitionId, String exhibitionDate, String registrationStart,
                            String registrationEnd, String imageUri, List<RegistrationField> fields) {
        Data data = get(exhibitionId);
        data.exhibitionDate = exhibitionDate;
        data.registrationStart = registrationStart;
        data.registrationEnd = registrationEnd;
        data.imageUri = imageUri == null ? "" : imageUri;
        data.fields.clear();
        data.fields.addAll(fields);
    }
}
