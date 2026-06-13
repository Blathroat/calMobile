package com.example.calmobile;

import android.content.Context;
import android.os.Environment;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Handles CSV data export for exhibitions, registrations, and users.
 * Files are saved to the app's external documents directory (no permissions needed).
 */
public class ExportManager {

    private static final String CSV_SEPARATOR = ",";
    private static final SimpleDateFormat TIMESTAMP_FORMAT =
            new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault());

    /**
     * Export all exhibitions to CSV.
     * @return absolute file path on success, null on failure
     */
    public static String exportExhibitions(Context context) {
        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();
        if (exhibitions.isEmpty()) {
            return null;
        }

        StringBuilder sb = new StringBuilder();
        // UTF-8 BOM for Excel compatibility
        sb.append('\uFEFF');
        // Header
        sb.append("ID").append(CSV_SEPARATOR)
          .append("展会名称").append(CSV_SEPARATOR)
          .append("展馆地点").append(CSV_SEPARATOR)
          .append("开展日期").append(CSV_SEPARATOR)
          .append("开放时间").append(CSV_SEPARATOR)
          .append("展会状态").append(CSV_SEPARATOR)
          .append("展会分类").append(CSV_SEPARATOR)
          .append("展会简介").append('\n');

        for (ExhibitorExhibition exh : exhibitions) {
            sb.append(escapeCsv(exh.getId())).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getTitle())).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getVenue())).append(CSV_SEPARATOR)
              .append(exh.getDay()).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getTime())).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getStatus())).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getCategory())).append(CSV_SEPARATOR)
              .append(escapeCsv(exh.getDescription())).append('\n');
        }

        String filename = "exhibitions_" + TIMESTAMP_FORMAT.format(new Date()) + ".csv";
        return writeToFile(context, filename, sb.toString());
    }

    /**
     * Export all registrations to CSV.
     * @return absolute file path on success, null on failure
     */
    public static String exportRegistrations(Context context) {
        RegistrationManager regManager = new RegistrationManager();
        List<Registration> registrations = regManager.list();
        if (registrations.isEmpty()) {
            return null;
        }

        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        // Header
        sb.append("ID").append(CSV_SEPARATOR)
          .append("展会名称").append(CSV_SEPARATOR)
          .append("开展日期").append(CSV_SEPARATOR)
          .append("开放时间").append(CSV_SEPARATOR)
          .append("展馆地点").append(CSV_SEPARATOR)
          .append("姓名").append(CSV_SEPARATOR)
          .append("观众类型").append(CSV_SEPARATOR)
          .append("报名信息").append(CSV_SEPARATOR)
          .append("审核状态").append('\n');

        for (Registration reg : registrations) {
            sb.append(escapeCsv(reg.getId())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getExhibitionTitle())).append(CSV_SEPARATOR)
              .append(reg.getExhibitionDay()).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getExhibitionTime())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getExhibitionVenue())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getVisitorName())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getVisitorType())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getNeedsSummary())).append(CSV_SEPARATOR)
              .append(escapeCsv(reg.getStatus().name())).append('\n');
        }

        String filename = "registrations_" + TIMESTAMP_FORMAT.format(new Date()) + ".csv";
        return writeToFile(context, filename, sb.toString());
    }

    /**
     * Export all users to CSV (admin only).
     * Does NOT export passwords or sensitive tokens.
     * @return absolute file path on success, null on failure
     */
    public static String exportUsers(Context context) {
        List<AdminUser> users = AdminUserManager.listAll();
        if (users.isEmpty()) {
            return null;
        }

        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        // Header — no password or token fields
        sb.append("ID").append(CSV_SEPARATOR)
          .append("昵称").append(CSV_SEPARATOR)
          .append("邮箱").append(CSV_SEPARATOR)
          .append("账号状态").append(CSV_SEPARATOR)
          .append("注册时间").append(CSV_SEPARATOR)
          .append("最近登录").append('\n');

        for (AdminUser user : users) {
            sb.append(escapeCsv(user.getId())).append(CSV_SEPARATOR)
              .append(escapeCsv(user.getNickname())).append(CSV_SEPARATOR)
              .append(escapeCsv(user.getEmail())).append(CSV_SEPARATOR)
              .append(escapeCsv(user.getStatus())).append(CSV_SEPARATOR)
              .append(escapeCsv(user.getRegistrationTime())).append(CSV_SEPARATOR)
              .append(escapeCsv(user.getLastLoginTime())).append('\n');
        }

        String filename = "users_" + TIMESTAMP_FORMAT.format(new Date()) + ".csv";
        return writeToFile(context, filename, sb.toString());
    }

    // ── Internal helpers ────────────────────────────────────────────

    /**
     * Escape a field for CSV output.
     * Wraps in double quotes if the field contains commas, quotes, or newlines.
     * Existing double quotes are doubled per RFC 4180.
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

    /**
     * Write content to a file in the app's external documents directory.
     * @return absolute file path on success, null on failure
     */
    private static String writeToFile(Context context, String filename, String content) {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (dir == null) {
            return null;
        }
        if (!dir.exists() && !dir.mkdirs()) {
            return null;
        }

        File file = new File(dir, filename);
        OutputStreamWriter writer = null;
        try {
            writer = new OutputStreamWriter(
                    new FileOutputStream(file), StandardCharsets.UTF_8);
            writer.write(content);
            writer.flush();
            return file.getAbsolutePath();
        } catch (IOException e) {
            return null;
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
        }
    }
}
