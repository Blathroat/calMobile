package com.example.calmobile;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 报名审核记录的存储（示例后端的一部分）。
 *
 * ## 主键只用一个命名空间
 *
 * 真实报名记录用**报名表自己的 id**（{@link RegistrationManager} 写入 SQLite 后返回的那个），
 * 因为审核状态最终要写回同一行：核销、撤销都要按这个 id 更新报名。
 * 示例记录则用 {@code demo-} 前缀，永远不会和报名 id 撞号。
 *
 * 之前这里自己发号（{@code registration-N}），与 SQLite 的报名 id 是两套编号，
 * 于是 {@code updateRegistrationStatus(record.id, ...)} 永远更新不到任何一行、
 * 撤销报名也改不到审核记录——两个存储看起来连着，实际各改各的。
 *
 * ## 示例数据是显式的
 *
 * 示例记录带 {@link Record#demo} 标记，调用方据此跳过对报名表的写入；
 * 没有对应的 SQLite 行就不去写它，而不是静默地写一个不存在的 id。
 */
public final class RegistrationReviewStore {

    public static final String STATUS_PENDING = "待审核";
    public static final String STATUS_APPROVED = "已通过";
    public static final String STATUS_REJECTED = "已拒绝";
    public static final String STATUS_CANCELLED = "已撤销";
    /** 展商扫码核销后的状态：报名码只能核销一次。 */
    public static final String STATUS_ATTENDED = "已参加";

    /** 示例记录 id 的前缀，用于与真实报名 id 区分。 */
    private static final String DEMO_PREFIX = "demo-";

    /** 一位报名人的审核记录。 */
    public static final class Record {
        public final String id;
        public final String exhibitionId;
        public final String visitorName;
        public final String registrationTime;
        public final String formAnswers;
        public String status;
        /** 示例数据：没有对应的报名表记录，不要按这个 id 去写报名表。 */
        public final boolean demo;

        Record(String id, String exhibitionId, String visitorName, String registrationTime,
                String formAnswers, String status, boolean demo) {
            this.id = id;
            this.exhibitionId = exhibitionId;
            this.visitorName = visitorName;
            this.registrationTime = registrationTime;
            this.formAnswers = formAnswers;
            this.status = status;
            this.demo = demo;
        }
    }

    /** 按 id 索引，查找是 O(1)；id 唯一由调用方保证（见类注释）。 */
    private static final Map<String, Record> RECORDS = new LinkedHashMap<>();
    private static int demoSequence = 1;

    private RegistrationReviewStore() {
    }

    /**
     * 报名提交后写入一条待审核记录。
     *
     * @param registrationId 报名表里的 id，审核状态最终要写回同一行
     */
    public static synchronized Record add(String registrationId, String exhibitionId,
            String visitorName, String answers) {
        Record record = new Record(registrationId, exhibitionId, visitorName, now(), answers,
                STATUS_PENDING, false);
        RECORDS.put(record.id, record);
        return record;
    }

    /**
     * 首次打开某个展会的报名列表时补充两条示例记录，让展商后台一进去就有内容可看。
     * 示例记录用 {@code demo-} 前缀发号，不会和真实报名 id 冲突。
     */
    public static synchronized void seedDemoIfEmpty(String exhibitionId) {
        for (Record record : RECORDS.values()) {
            if (sameExhibition(record.exhibitionId, exhibitionId)) {
                return;
            }
        }
        addDemo(exhibitionId, "张伟", "06-08 09:15", "兴趣方向：智能家居\n洽谈需求：是", STATUS_PENDING);
        addDemo(exhibitionId, "李娜", "06-08 10:30", "兴趣方向：全屋方案\n洽谈需求：否", STATUS_APPROVED);
    }

    private static void addDemo(String exhibitionId, String visitorName, String time,
            String answers, String status) {
        String id = DEMO_PREFIX + ++demoSequence;
        RECORDS.put(id, new Record(id, exhibitionId, visitorName, time, answers, status, true));
    }

    public static synchronized Record find(String id) {
        return id == null ? null : RECORDS.get(id);
    }

    public static synchronized boolean updateStatus(String id, String status) {
        Record record = find(id);
        if (record == null) {
            return false;
        }
        record.status = status;
        return true;
    }

    /** 按展会筛选记录；exhibitionId 为空时返回全部。 */
    public static synchronized List<Record> listByExhibition(String exhibitionId) {
        List<Record> result = new ArrayList<>();
        for (Record record : RECORDS.values()) {
            if (exhibitionId == null || exhibitionId.isEmpty()
                    || sameExhibition(record.exhibitionId, exhibitionId)) {
                result.add(record);
            }
        }
        return result;
    }

    public static synchronized int countByStatus(String exhibitionId, String status) {
        int count = 0;
        for (Record record : listByExhibition(exhibitionId)) {
            if (status == null || status.isEmpty() || "全部".equals(status) || status.equals(record.status)) {
                count++;
            }
        }
        return count;
    }

    private static boolean sameExhibition(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    private static String now() {
        return new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(new Date());
    }
}
