package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

/**
 * 审核记录存储的 id 规则。
 * <p>
 * 这里守住的核心不变量是「一条报名只有一个 id」：真实记录用报名表自己的 id，
 * 示例记录用 demo- 前缀。以前两者各发各的号，导致核销与撤销都改不到报名行。
 */
public class RegistrationReviewStoreTest {

    @Test
    public void 真实记录使用报名表传入的_id() {
        RegistrationReviewStore.Record record =
                RegistrationReviewStore.add("reg-1001", "exh-test-a", "王五", "兴趣方向：测试");

        assertEquals("reg-1001", record.id);
        assertFalse(record.demo);
        assertSame(record, RegistrationReviewStore.find("reg-1001"));
        assertEquals(RegistrationReviewStore.STATUS_PENDING, record.status);
    }

    @Test
    public void 示例记录不会占用报名的_id() {
        RegistrationReviewStore.seedDemoIfEmpty("exh-test-b");

        List<RegistrationReviewStore.Record> records = RegistrationReviewStore.listByExhibition("exh-test-b");
        assertEquals(2, records.size());
        for (RegistrationReviewStore.Record record : records) {
            assertTrue("示例记录必须带 demo 标记", record.demo);
            assertTrue("示例 id 不能是纯报名 id：" + record.id, record.id.startsWith("demo-"));
        }
    }

    @Test
    public void 同一展会重复播种不会叠加示例数据() {
        RegistrationReviewStore.seedDemoIfEmpty("exh-test-c");
        RegistrationReviewStore.seedDemoIfEmpty("exh-test-c");
        RegistrationReviewStore.seedDemoIfEmpty("exh-test-c");

        assertEquals(2, RegistrationReviewStore.listByExhibition("exh-test-c").size());
    }

    @Test
    public void 同一个_id_不会出现两条记录() {
        RegistrationReviewStore.add("reg-2002", "exh-test-d", "赵六", "答案");
        RegistrationReviewStore.add("reg-2002", "exh-test-d", "赵六", "答案");

        // 后写入的覆盖前一条：id 唯一，审核状态只可能有一份。
        assertEquals(1, RegistrationReviewStore.countByStatus("exh-test-d", null));
    }

    @Test
    public void 撤销与核销能按报名_id_改到同一条记录() {
        RegistrationReviewStore.add("reg-3003", "exh-test-e", "孙七", "答案");

        assertTrue(RegistrationReviewStore.updateStatus("reg-3003", RegistrationReviewStore.STATUS_CANCELLED));
        assertEquals(RegistrationReviewStore.STATUS_CANCELLED,
                RegistrationReviewStore.find("reg-3003").status);
        assertTrue(RegistrationReviewStore.updateStatus("reg-3003", RegistrationReviewStore.STATUS_ATTENDED));
        assertEquals(1, RegistrationReviewStore.countByStatus("exh-test-e", RegistrationReviewStore.STATUS_ATTENDED));
    }

    @Test
    public void 按展会筛选为空时返回全部记录() {
        RegistrationReviewStore.add("reg-4004", "exh-test-f", "周八", "答案");
        RegistrationReviewStore.add("reg-4005", "exh-test-g", "吴九", "答案");

        List<RegistrationReviewStore.Record> all = RegistrationReviewStore.listByExhibition("");
        assertTrue(all.size() >= 2);
        assertNotNull(RegistrationReviewStore.find("reg-4004"));
        assertNotNull(RegistrationReviewStore.find("reg-4005"));
    }

    @Test
    public void 查不到的_id_返回空而不是抛异常() {
        assertNull(RegistrationReviewStore.find("reg-not-exists"));
        assertNull(RegistrationReviewStore.find(null));
        assertFalse(RegistrationReviewStore.updateStatus("reg-not-exists", RegistrationReviewStore.STATUS_APPROVED));
    }
}
