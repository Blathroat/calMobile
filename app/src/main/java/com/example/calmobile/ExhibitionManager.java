package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * In-memory exhibition manager for exhibitor backend.
 * Pattern mirrors RegistrationManager: static list, CRUD, sample data.
 */
public class ExhibitionManager {
    private static final List<ExhibitorExhibition> exhibitions = new ArrayList<>();
    private static int nextId = 1;
    private static boolean initialized = false;

    /** Seed sample data on first access. */
    public static void ensureInitialized() {
        if (initialized) {
            return;
        }
        initialized = true;

        add(8, "华南智能家居展", "深圳会展中心 3 号馆", "09:00-17:30",
                ExhibitorExhibition.STATUS_OPEN, "智能门锁、全屋方案和节能家电集中展示。", "智能家居");
        add(15, "大湾区物流技术展", "广州琶洲展馆 C 区", "10:00-18:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV、仓储机器人与冷链物流方案。", "物流技术");
        add(22, "数字健康峰会", "上海国家会展中心", "09:30-16:00",
                ExhibitorExhibition.STATUS_CLOSED, "医疗AI、远程诊疗和穿戴设备专题。", "医疗健康");
        add(28, "新材料应用展", "北京中国国际展览中心", "10:00-17:00",
                ExhibitorExhibition.STATUS_ENDED, "碳纤维、石墨烯和可降解材料展示。", "新材料");
    }

    public static ExhibitorExhibition add(int day, String title, String venue, String time,
            String status, String description, String category) {
        ExhibitorExhibition exhibition = new ExhibitorExhibition(
                "exh-" + nextId, day, title, venue, time, status, description, category);
        nextId++;
        exhibitions.add(exhibition);
        return exhibition;
    }

    public static boolean update(String id, int day, String title, String venue, String time,
            String status, String description, String category) {
        ExhibitorExhibition exhibition = findById(id);
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
        ExhibitorExhibition exhibition = findById(id);
        if (exhibition == null) {
            return false;
        }
        exhibitions.remove(exhibition);
        return true;
    }

    public static boolean updateStatus(String id, String newStatus) {
        ExhibitorExhibition exhibition = findById(id);
        if (exhibition == null) {
            return false;
        }
        exhibition.setStatus(newStatus);
        return true;
    }

    public static List<ExhibitorExhibition> listAll() {
        return new ArrayList<>(exhibitions);
    }

    public static ExhibitorExhibition findById(String id) {
        for (ExhibitorExhibition exhibition : exhibitions) {
            if (exhibition.getId().equals(id)) {
                return exhibition;
            }
        }
        return null;
    }

    /** Return fake registration records for a given exhibition. */
    public static List<String> getRegistrationRecords(ExhibitorExhibition exhibition) {
        List<String> records = new ArrayList<>();
        // Generate deterministic fake records based on exhibition title
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
}
