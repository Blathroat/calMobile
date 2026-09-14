package com.example.calmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * 首页示例展会目录。
 * <p>
 * 现有首页使用 {@code MainActivity} 内置的 {@code SAMPLE_EXHIBITIONS}（带月份），
 * 而展商后台使用 SQLite 中的 {@code ExhibitorExhibition}（只有日期号）。WebView 前端需要一份
 * 两者都能渲染的数据，因此把首页样例集中到本类，并为数据库记录补充展商、亮点等展示字段。
 */
final class ExhibitionCatalog {

    /** 一条首页样例展会。 */
    static final class Entry {
        final int month;
        final int day;
        final String title;
        final String exhibitor;
        final String exhibitorNote;
        final List<String> highlights;

        Entry(int month, int day, String title, String exhibitor, String exhibitorNote,
                String... highlights) {
            this.month = month;
            this.day = day;
            this.title = title;
            this.exhibitor = exhibitor;
            this.exhibitorNote = exhibitorNote;
            this.highlights = new ArrayList<>();
            for (String item : highlights) {
                this.highlights.add(item);
            }
        }
    }

    private static final List<Entry> ENTRIES = new ArrayList<>();

    static {
        ENTRIES.add(new Entry(6, 6, "华南智能制造展", "华南会展", "面向制造业采购与技术负责人",
                "智能工厂", "工业自动化", "供需对接"));
        ENTRIES.add(new Entry(6, 12, "绿色能源装备展", "北辰会展", "面向产业链专业观众",
                "储能方案", "光伏逆变", "低碳园区"));
        ENTRIES.add(new Entry(6, 12, "跨境电商选品会", "跨境选品联盟", "面向品牌方与渠道采购",
                "选品对接", "海外仓", "直播电商"));
        ENTRIES.add(new Entry(6, 21, "城市更新材料展", "城市更新促进会", "面向建筑材料与旧改服务商",
                "节能门窗", "建筑材料", "旧改服务"));
        ENTRIES.add(new Entry(7, 5, "国际电子展", "电子产业协会", "芯片、传感器与物联网方案",
                "半导体", "传感器", "物联网"));
        ENTRIES.add(new Entry(7, 15, "亚洲食品博览会", "亚洲食品展组委会", "亚太地区优质食品供应商",
                "休闲食品", "饮料", "健康食品"));
        ENTRIES.add(new Entry(8, 10, "国际汽车展", "汽车工业协会", "新能源与智能驾驶技术",
                "新能源汽车", "智能驾驶", "零部件"));
    }

    private ExhibitionCatalog() {
    }

    /** 按标题匹配样例，用于补充展商与亮点。 */
    static Entry findByTitle(String title) {
        if (title == null) {
            return null;
        }
        for (Entry entry : ENTRIES) {
            if (entry.title.equals(title)) {
                return entry;
            }
        }
        return null;
    }

    static List<Entry> all() {
        return new ArrayList<>(ENTRIES);
    }
}
