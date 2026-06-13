package com.example.calmobile;

import org.junit.Before;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Integration tests for the complete registration workflow:
 * register → approve → reject (cancel).
 *
 * Registration model supports PENDING and CANCELLED statuses.
 * "Approve" is verified by confirming PENDING status after submission.
 * "Reject" is performed via the cancel action.
 *
 * Tests exercise RegistrationManager end-to-end using in-memory storage.
 */
public class RegistrationWorkflowIntegrationTest {

    private RegistrationManager manager;

    @Before
    public void setUp() {
        manager = new RegistrationManager();
    }

    // ── Full lifecycle: register → verify pending → cancel ────────

    @Test
    public void fullLifecycleRegisterApproveReject() {
        // Step 1: Register (submit)
        Registration reg = manager.submit(
                "绿色能源装备展", 12, "10:00-18:00", "广州琶洲展馆 A 区",
                "张三", "采购负责人", "需要洽谈，已勾选提醒");

        assertNotNull(reg);
        String id = reg.getId();
        assertEquals("绿色能源装备展", reg.getExhibitionTitle());
        assertEquals("张三", reg.getVisitorName());

        // Step 2: Approve — verify registration is PENDING (accepted by system)
        List<Registration> all = manager.list();
        assertEquals(1, all.size());
        Registration pending = all.get(0);
        assertEquals(Registration.Status.PENDING, pending.getStatus());
        assertEquals(id, pending.getId());

        // Step 3: Reject (cancel)
        assertTrue(manager.cancel(id));

        // Verify cancelled
        List<Registration> afterCancel = manager.list();
        assertEquals(1, afterCancel.size());
        assertEquals(Registration.Status.CANCELLED, afterCancel.get(0).getStatus());
    }

    // ── Multiple registrations: submit several, cancel one ────────

    @Test
    public void multipleRegistrationsSubmitAndSelectiveCancel() {
        // Submit three registrations
        Registration reg1 = manager.submit(
                "展会A", 1, "09:00-17:00", "场馆A",
                "张三", "专业观众", "仅参观");
        Registration reg2 = manager.submit(
                "展会B", 2, "10:00-18:00", "场馆B",
                "李四", "采购负责人", "需要洽谈");
        Registration reg3 = manager.submit(
                "展会C", 3, "11:00-19:00", "场馆C",
                "王五", "媒体或合作伙伴", "需要洽谈");

        assertEquals(3, manager.list().size());

        // All should be PENDING
        for (Registration r : manager.list()) {
            assertEquals(Registration.Status.PENDING, r.getStatus());
        }

        // Cancel the second one (reject)
        assertTrue(manager.cancel(reg2.getId()));

        // Verify: 3 total, middle one cancelled
        List<Registration> afterCancel = manager.list();
        assertEquals(3, afterCancel.size());

        assertEquals(Registration.Status.PENDING, afterCancel.get(0).getStatus());
        assertEquals("张三", afterCancel.get(0).getVisitorName());

        assertEquals(Registration.Status.CANCELLED, afterCancel.get(1).getStatus());
        assertEquals("李四", afterCancel.get(1).getVisitorName());

        assertEquals(Registration.Status.PENDING, afterCancel.get(2).getStatus());
        assertEquals("王五", afterCancel.get(2).getVisitorName());
    }

    // ── Cancel preserves other registration data ──────────────────

    @Test
    public void cancelPreservesRegistrationData() {
        Registration reg = manager.submit(
                "测试展会", 15, "10:00-18:00", "测试场馆",
                "测试用户", "采购负责人", "需要洽谈");

        manager.cancel(reg.getId());

        Registration cancelled = manager.list().get(0);
        assertEquals("测试展会", cancelled.getExhibitionTitle());
        assertEquals(15, cancelled.getExhibitionDay());
        assertEquals("10:00-18:00", cancelled.getExhibitionTime());
        assertEquals("测试场馆", cancelled.getExhibitionVenue());
        assertEquals("测试用户", cancelled.getVisitorName());
        assertEquals("采购负责人", cancelled.getVisitorType());
        assertEquals("需要洽谈", cancelled.getNeedsSummary());
        assertEquals(Registration.Status.CANCELLED, cancelled.getStatus());
    }

    // ── Cancel nonexistent returns false ──────────────────────────

    @Test
    public void cancelNonexistentRegistrationReturnsFalse() {
        assertFalse(manager.cancel("nonexistent-id"));
        assertTrue(manager.list().isEmpty());
    }

    // ── Double cancel is safe ─────────────────────────────────────

    @Test
    public void doubleCancelIsIdempotent() {
        Registration reg = manager.submit(
                "展会", 1, "09:00", "场馆",
                "用户", "类型", "需求");

        assertTrue(manager.cancel(reg.getId()));
        // Second cancel should still return true (finds the registration)
        assertTrue(manager.cancel(reg.getId()));

        // Status remains CANCELLED
        assertEquals(Registration.Status.CANCELLED, manager.list().get(0).getStatus());
    }

    // ── Submit with all visitor types ─────────────────────────────

    @Test
    public void submitWithDifferentVisitorTypes() {
        Registration r1 = manager.submit("展", 1, "t", "v", "A", "专业观众", "需求");
        Registration r2 = manager.submit("展", 1, "t", "v", "B", "采购负责人", "需求");
        Registration r3 = manager.submit("展", 1, "t", "v", "C", "媒体或合作伙伴", "需求");

        assertEquals(3, manager.list().size());
        assertEquals("专业观众", r1.getVisitorType());
        assertEquals("采购负责人", r2.getVisitorType());
        assertEquals("媒体或合作伙伴", r3.getVisitorType());
    }

    // ── List returns empty when no registrations ──────────────────

    @Test
    public void listReturnsEmptyWhenNoRegistrations() {
        assertTrue(manager.list().isEmpty());
    }

    // ── List returns independent copy ─────────────────────────────

    @Test
    public void listReturnsIndependentCopy() {
        manager.submit("展", 1, "t", "v", "用户", "类型", "需求");

        List<Registration> copy = manager.list();
        copy.clear();

        assertEquals(1, manager.list().size());
    }
}
