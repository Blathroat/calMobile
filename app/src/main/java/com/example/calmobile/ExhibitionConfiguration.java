package com.example.calmobile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 展会扩展信息的存储。
 *
 * 这些字段（展会日期、报名起止、图片、简介格式、报名二维码开关、报名收集项）不在
 * {@link DatabaseHelper} 的表结构里，因此由本类单独保存。它是**示例后端的一部分**：
 * 数据只活在进程内，接入真实后端后整层由 API 取代（见 README「前后端边界」）。
 *
 * 写入统一走 {@link Patch}。原来的 {@code save(...)} 有五个位置参数，其中三个都是
 * 日期字符串（展会日期、报名开始、报名结束），调用处极易写错顺序；改成具名链式
 * 写法后参数顺序不再有意义，也顺带合并了原来分开的
 * {@code saveDescriptionFormat} / {@code saveRegistrationQr}。
 */
public final class ExhibitionConfiguration {

    /** 未配置过展会时的默认日期；{@link #displayDate} 认这个值并回落到展会自身的日期。 */
    private static final String DEFAULT_DATE = "2026-06-01";

    private static final Map<String, Data> DATA = new LinkedHashMap<>();

    /** 一个展会的扩展信息，字段都有可用默认值。 */
    public static final class Data {
        String exhibitionDate = DEFAULT_DATE;
        String registrationStart = "2026-05-01";
        String registrationEnd = "2026-05-31";
        String imageUri = "";
        /** 简介内容的存储格式：html（旧富文本编辑器写入）或 md（EasyMDE 写入的 Markdown）。 */
        String descriptionFormat = "md";
        /** 是否启用报名二维码：开启后报名通过的用户在报名详情里展示报名码，展商可扫码核销。 */
        boolean registrationQrEnabled = false;
        /** 报名表的收集项；写入时按值复制，避免调用方持有的列表与本对象互相别名。 */
        List<RegistrationField> fields = new ArrayList<>();
    }

    /**
     * 一次写入要改的字段；没设过的字段保持原值。
     * <p>
     * 页面保存展会时分几段写入（日期、简介格式、二维码开关、收集项），
     * 用 Patch 可以只写其中一段，不会把其它段覆盖回默认值。
     */
    public static final class Patch {
        private String exhibitionDate;
        private String registrationStart;
        private String registrationEnd;
        private String imageUri;
        private String descriptionFormat;
        private Boolean registrationQrEnabled;
        private List<RegistrationField> fields;

        /** 展会日期与报名起止日期，三者一起写。 */
        public Patch dates(String exhibitionDate, String registrationStart, String registrationEnd) {
            this.exhibitionDate = exhibitionDate;
            this.registrationStart = registrationStart;
            this.registrationEnd = registrationEnd;
            return this;
        }

        public Patch image(String imageUri) {
            this.imageUri = imageUri;
            return this;
        }

        /** 简介格式，只接受 html 与 md。 */
        public Patch descriptionFormat(String format) {
            this.descriptionFormat = "html".equals(format) ? "html" : "md";
            return this;
        }

        public Patch registrationQr(boolean enabled) {
            this.registrationQrEnabled = enabled;
            return this;
        }

        public Patch fields(List<RegistrationField> fields) {
            this.fields = fields;
            return this;
        }
    }

    private ExhibitionConfiguration() {
    }

    /**
     * 读取扩展信息。
     * <p>
     * **不写入存储**：没配置过的展会返回一份默认值，调用方拿到的是临时对象，
     * 改它不会影响存储（写一律走 {@link #save}）。
     */
    public static Data get(String exhibitionId) {
        Data data = DATA.get(exhibitionId);
        return data == null ? new Data() : data;
    }

    public static boolean isRegistrationQrEnabled(String exhibitionId) {
        return get(exhibitionId).registrationQrEnabled;
    }

    public static String displayDate(String exhibitionId, int fallbackDay) {
        String date = get(exhibitionId).exhibitionDate;
        if (date == null || date.isEmpty() || DEFAULT_DATE.equals(date)) {
            return String.format(java.util.Locale.CHINA, "2026-06-%02d", fallbackDay);
        }
        return date;
    }

    /** 写入一段扩展信息；只覆盖 Patch 里设过的字段。 */
    public static void save(String exhibitionId, Patch patch) {
        if (exhibitionId == null || exhibitionId.isEmpty() || patch == null) {
            return;
        }
        Data data = DATA.computeIfAbsent(exhibitionId, key -> new Data());
        if (patch.exhibitionDate != null) {
            data.exhibitionDate = patch.exhibitionDate;
        }
        if (patch.registrationStart != null) {
            data.registrationStart = patch.registrationStart;
        }
        if (patch.registrationEnd != null) {
            data.registrationEnd = patch.registrationEnd;
        }
        if (patch.imageUri != null) {
            data.imageUri = patch.imageUri;
        }
        if (patch.descriptionFormat != null) {
            data.descriptionFormat = patch.descriptionFormat;
        }
        if (patch.registrationQrEnabled != null) {
            data.registrationQrEnabled = patch.registrationQrEnabled;
        }
        if (patch.fields != null) {
            // 复制一份：调用方常常把 get() 拿到的列表原样传回来，直接 addAll 会自己清空自己。
            data.fields = new ArrayList<>(patch.fields);
        }
    }
}
