package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * Exhibition manager backed by SQLite (via {@link DatabaseHelper}).
 * Falls back to in-memory storage when no database is available
 * (e.g. unit tests without Application context).
 * <p>
 * Public API is unchanged from the original in-memory version.
 */
public class ExhibitionManager {

    // ── 内存回退（测试环境） ────────────────────
    private static final List<ExhibitorExhibition> fallbackExhibitions = new ArrayList<>();
    private static int fallbackNextId = 1;
    private static boolean initialized = false;

    /** 首次访问时写入示例数据。 */
    public static void ensureInitialized() {
        if (initialized) {
            return;
        }
        initialized = true;

        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            // SQLite 模式：仅在数据表为空时写入示例数据
            if (dbHelper.getExhibitionCount() == 0) {
                seedDatabase(dbHelper);
            }
        } else {
            // 内存回退（测试环境）
            seedInMemory();
        }
    }

    public static ExhibitorExhibition add(int day, String title, String venue, String time,
            String status, String description, String category) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            String id = dbHelper.insertExhibition(day, title, venue, time, status, description, category);
            if (id != null) {
                return dbHelper.getExhibitionById(id);
            }
            return null;
        }
        return addInMemory(day, title, venue, time, status, description, category);
    }

    public static boolean update(String id, int day, String title, String venue, String time,
            String status, String description, String category) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.updateExhibition(id, day, title, venue, time, status, description, category);
        }
        // 内存回退
        ExhibitorExhibition exhibition = findByIdInMemory(id);
        if (exhibition == null) {
            return false;
        }
        exhibition.setDay(day);
        exhibition.setTitle(title);
        exhibition.setVenue(venue);
        exhibition.setTime(time);
        exhibition.setStatus(status);
        exhibition.setDescription(description);
        exhibition.setCategory(category);
        return true;
    }

    public static boolean delete(String id) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.deleteExhibition(id);
        }
        ExhibitorExhibition exhibition = findByIdInMemory(id);
        if (exhibition == null) {
            return false;
        }
        fallbackExhibitions.remove(exhibition);
        return true;
    }

    public static boolean updateStatus(String id, String newStatus) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.updateExhibitionStatus(id, newStatus);
        }
        ExhibitorExhibition exhibition = findByIdInMemory(id);
        if (exhibition == null) {
            return false;
        }
        exhibition.setStatus(newStatus);
        return true;
    }

    public static List<ExhibitorExhibition> listAll() {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getAllExhibitions();
        }
        return new ArrayList<>(fallbackExhibitions);
    }

    public static ExhibitorExhibition findById(String id) {
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.getExhibitionById(id);
        }
        return findByIdInMemory(id);
    }

    /** 按标题、地点、分类或简介搜索展会。 */
    public static List<ExhibitorExhibition> search(String query) {
        if (query == null || query.trim().isEmpty()) {
            return new ArrayList<>();
        }
        DatabaseHelper dbHelper = DatabaseHelper.getInstance();
        if (dbHelper != null) {
            return dbHelper.searchExhibitions(query.trim());
        }
        // 内存回退
        List<ExhibitorExhibition> results = new ArrayList<>();
        String lower = query.trim().toLowerCase();
        for (ExhibitorExhibition ex : fallbackExhibitions) {
            if (ex.getTitle().toLowerCase().contains(lower)
                    || ex.getVenue().toLowerCase().contains(lower)
                    || ex.getCategory().toLowerCase().contains(lower)
                    || ex.getDescription().toLowerCase().contains(lower)) {
                results.add(ex);
            }
        }
        return results;
    }

    /** 返回指定展会的演示报名记录。 */
    public static List<String> getRegistrationRecords(ExhibitorExhibition exhibition) {
        List<String> records = new ArrayList<>();
        // 根据展会标题生成稳定的演示记录
        String title = exhibition.getTitle();
        records.add("张伟 · 专业观众 · 需要洽谈");
        records.add("李娜 · 采购负责人 · 仅参观");
        records.add("王磊 · 媒体或合作伙伴 · 需要洽谈");
        if (title.contains("智能") || title.contains("数字")) {
            records.add("赵敏 · 专业观众 · 仅参观");
            records.add("陈晨 · 采购负责人 · 需要洽谈");
        }
        if (title.contains("物流")) {
            records.add("刘洋 · 专业观众 · 仅参观");
        }
        return records;
    }

    // ── 内存辅助方法 ─────────────────────────────────────────

    private static void seedDatabase(DatabaseHelper dbHelper) {
        dbHelper.insertExhibition(8, "华南智能家居展", "深圳会展中心 3 号馆", "09:00-17:30",
                ExhibitorExhibition.STATUS_OPEN, "智能门锁、全屋方案和节能家电集中展示。", "智能家居");
        dbHelper.insertExhibition(15, "大湾区物流技术展", "广州琶洲展馆 C 区", "10:00-18:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV、仓储机器人与冷链物流方案。", "物流技术");
        dbHelper.insertExhibition(22, "数字健康峰会", "上海国家会展中心", "09:30-16:00",
                ExhibitorExhibition.STATUS_CLOSED, "医疗AI、远程诊疗和穿戴设备专题。", "医疗健康");
        dbHelper.insertExhibition(28, "新材料应用展", "北京中国国际展览中心", "10:00-17:00",
                ExhibitorExhibition.STATUS_ENDED, "碳纤维、石墨烯和可降解材料展示。", "新材料");
    }

    private static void seedInMemory() {
        addInMemory(8, "华南智能家居展", "深圳会展中心 3 号馆", "09:00-17:30",
                ExhibitorExhibition.STATUS_OPEN, "智能门锁、全屋方案和节能家电集中展示。", "智能家居");
        addInMemory(15, "大湾区物流技术展", "广州琶洲展馆 C 区", "10:00-18:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV、仓储机器人与冷链物流方案。", "物流技术");
        addInMemory(22, "数字健康峰会", "上海国家会展中心", "09:30-16:00",
                ExhibitorExhibition.STATUS_CLOSED, "医疗AI、远程诊疗和穿戴设备专题。", "医疗健康");
        addInMemory(28, "新材料应用展", "北京中国国际展览中心", "10:00-17:00",
                ExhibitorExhibition.STATUS_ENDED, "碳纤维、石墨烯和可降解材料展示。", "新材料");
    }

    private static ExhibitorExhibition addInMemory(int day, String title, String venue, String time,
            String status, String description, String category) {
        ExhibitorExhibition exhibition = new ExhibitorExhibition(
                "exh-" + fallbackNextId, day, title, venue, time, status, description, category);
        fallbackNextId++;
        fallbackExhibitions.add(exhibition);
        return exhibition;
    }

    private static ExhibitorExhibition findByIdInMemory(String id) {
        for (ExhibitorExhibition exhibition : fallbackExhibitions) {
            if (exhibition.getId().equals(id)) {
                return exhibition;
            }
        }
        return null;
    }
}

