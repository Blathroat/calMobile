package com.example.calmobile;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 把前端传来的数据行拼成 CSV。
 *
 * 数据由**前端**负责取（它在 `admin.js` 里已经从后端拿到展会列表），原生只做设备侧的事：
 * 拼 CSV、加 UTF-8 BOM（Excel 打开中文不乱码）、交给系统「另存为」面板。
 * 表头留在原生，是因为它属于导出格式而不是页面文案。
 */
final class ExportManager {

    private static final String CSV_SEPARATOR = ",";

    private ExportManager() {
    }

    /**
     * 展会导出。
     *
     * @param rows 前端传来的展会行，键名与后端返回的展会对象一致
     *             （id / title / venue / date / time / status / category / description）
     * @return CSV 文本；没有数据时返回 null
     */
    static String exhibitionsCsv(List<Map<String, Object>> rows) {
        if (rows == null || rows.isEmpty()) {
            return null;
        }
        StringBuilder builder = new StringBuilder();
        // UTF-8 BOM：Excel 直接双击打开时中文表头才不会乱码。
        builder.append('\uFEFF');
        builder.append("ID").append(CSV_SEPARATOR)
                .append("展会名称").append(CSV_SEPARATOR)
                .append("展馆地点").append(CSV_SEPARATOR)
                .append("开展日期").append(CSV_SEPARATOR)
                .append("开放时间").append(CSV_SEPARATOR)
                .append("展会状态").append(CSV_SEPARATOR)
                .append("展会分类").append(CSV_SEPARATOR)
                .append("展会简介").append('\n');

        for (Map<String, Object> row : rows) {
            builder.append(escapeCsv(value(row, "id"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "title"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "venue"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "date"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "time"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "status"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "category"))).append(CSV_SEPARATOR)
                    .append(escapeCsv(value(row, "description"))).append('\n');
        }
        return builder.toString();
    }

    /** 导出文件名：带时间戳，避免多次导出互相覆盖。 */
    static String fileName(String prefix) {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
        return prefix + "_" + stamp + ".csv";
    }

    private static String value(Map<String, Object> row, String key) {
        Object value = row == null ? null : row.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    /**
     * 转义一个 CSV 字段：含逗号、引号或换行时用双引号包起来，
     * 内部的双引号按 RFC 4180 翻倍。
     */
    static String escapeCsv(String field) {
        if (field == null) {
            return "";
        }
        if (field.contains(",") || field.contains("\"") || field.contains("\n")) {
            return "\"" + field.replace("\"", "\"\"") + "\"";
        }
        return field;
    }
}
