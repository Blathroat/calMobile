package com.example.calmobile;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 报名审核记录的会话内存储。
 * <p>
 * 展商后台的审核状态属于演示数据，历史实现保存在
 * {@code RegistrationManagementActivity} 的静态列表中。WebView 前端需要同一份数据，
 * 因此把存储抽到本类，旧页面与新的 {@code WebAppBridge} 共用，避免出现两份不一致的审核记录。
 */
public final class RegistrationReviewStore {

    public static final String STATUS_PENDING = "待审核";
    public static final String STATUS_APPROVED = "已通过";
    public static final String STATUS_REJECTED = "已拒绝";
    public static final String STATUS_CANCELLED = "已撤销";

    /** 一位报名人的审核记录。 */
    public static final class Record {
        public final String id;
        public final String exhibitionId;
        public final String visitorName;
        public final String registrationTime;
        public final String formAnswers;
        public String status;

        Record(String id, String exhibitionId, String visitorName, String registrationTime,
                String formAnswers, String status) {
            this.id = id;
            this.exhibitionId = exhibitionId;
            this.visitorName = visitorName;
            this.registrationTime = registrationTime;
            this.formAnswers = formAnswers;
            this.status = status;
        }
    }

    private static final List<Record> RECORDS = new ArrayList<>();
    private static int nextId = 1;

    private RegistrationReviewStore() {
    }

    /** 报名提交后写入一条待审核记录。 */
    public static synchronized Record add(String exhibitionId, String visitorName, String answers) {
        Record record = new Record("registration-" + nextId++, exhibitionId, visitorName,
                new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(new Date()),
                answers, STATUS_PENDING);
        RECORDS.add(record);
        return record;
    }

    /** 首次打开某个展会的报名列表时补充两条示例记录。 */
    public static synchronized void ensureSeeded(String exhibitionId) {
        for (Record record : RECORDS) {
            if (exhibitionId == null ? record.exhibitionId == null : exhibitionId.equals(record.exhibitionId)) {
                return;
            }
        }
        RECORDS.add(new Record("registration-" + nextId++, exhibitionId, "张伟", "06-08 09:15",
                "兴趣方向：智能家居\n洽谈需求：是", STATUS_PENDING));
        RECORDS.add(new Record("registration-" + nextId++, exhibitionId, "李娜", "06-08 10:30",
                "兴趣方向：全屋方案\n洽谈需求：否", STATUS_APPROVED));
    }

    public static synchronized Record find(String id) {
        for (Record record : RECORDS) {
            if (record.id.equals(id)) {
                return record;
            }
        }
        return null;
    }

    public static synchronized boolean updateStatus(String id, String status) {
        Record record = find(id);
        if (record == null) {
            return false;
        }
        record.status = status;
        return true;
    }

    /** 按展会筛选记录，exhibitionId 为空时返回全部。 */
    public static synchronized List<Record> listByExhibition(String exhibitionId) {
        List<Record> result = new ArrayList<>();
        for (Record record : RECORDS) {
            boolean same = exhibitionId == null || exhibitionId.isEmpty()
                    ? record.exhibitionId == null
                    : exhibitionId.equals(record.exhibitionId);
            if (same) {
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
}
