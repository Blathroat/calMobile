package com.example.calmobile;

import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Integration tests for the complete exhibition lifecycle workflow:
 * create → edit → delete.
 *
 * Tests exercise ExhibitionManager end-to-end using in-memory storage.
 */
public class ExhibitionWorkflowIntegrationTest {

    @Before
    public void resetStaticState() throws Exception {
        Field exhibitionsField = ExhibitionManager.class.getDeclaredField("fallbackExhibitions");
        exhibitionsField.setAccessible(true);
        ((List<?>) exhibitionsField.get(null)).clear();

        Field nextIdField = ExhibitionManager.class.getDeclaredField("fallbackNextId");
        nextIdField.setAccessible(true);
        nextIdField.setInt(null, 1);

        Field initializedField = ExhibitionManager.class.getDeclaredField("initialized");
        initializedField.setAccessible(true);
        initializedField.setBoolean(null, false);
    }

    // ── Full lifecycle: create → edit → delete ────────────────────

    @Test
    public void fullLifecycleCreateEditDelete() {
        // Step 1: Create
        ExhibitorExhibition created = ExhibitionManager.add(
                10, "测试展会", "深圳会展中心", "09:00-17:00",
                ExhibitorExhibition.STATUS_OPEN, "测试描述", "测试分类");

        assertNotNull(created);
        String id = created.getId();
        assertEquals("测试展会", created.getTitle());
        assertEquals("深圳会展中心", created.getVenue());
        assertEquals(ExhibitorExhibition.STATUS_OPEN, created.getStatus());

        // Step 2: Edit — update title, venue, status
        boolean updated = ExhibitionManager.update(id,
                15, "更新后展会", "广州琶洲展馆", "10:00-18:00",
                ExhibitorExhibition.STATUS_CLOSED, "更新后描述", "新分类");

        assertTrue(updated);
        ExhibitorExhibition edited = ExhibitionManager.findById(id);
        assertNotNull(edited);
        assertEquals("更新后展会", edited.getTitle());
        assertEquals("广州琶洲展馆", edited.getVenue());
        assertEquals(15, edited.getDay());
        assertEquals("10:00-18:00", edited.getTime());
        assertEquals(ExhibitorExhibition.STATUS_CLOSED, edited.getStatus());
        assertEquals("更新后描述", edited.getDescription());
        assertEquals("新分类", edited.getCategory());

        // Step 3: Delete
        assertTrue(ExhibitionManager.delete(id));
        assertNull(ExhibitionManager.findById(id));
        assertEquals(0, ExhibitionManager.listAll().size());
    }

    // ── Status transitions through lifecycle ──────────────────────

    @Test
    public void statusTransitionsThroughLifecycle() {
        ExhibitorExhibition ex = ExhibitionManager.add(
                1, "状态测试展", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        String id = ex.getId();

        // Open → Closed
        assertTrue(ExhibitionManager.updateStatus(id, ExhibitorExhibition.STATUS_CLOSED));
        assertEquals(ExhibitorExhibition.STATUS_CLOSED, ExhibitionManager.findById(id).getStatus());
        assertFalse(ExhibitionManager.findById(id).isOpenForRegistration());

        // Closed → Ended
        assertTrue(ExhibitionManager.updateStatus(id, ExhibitorExhibition.STATUS_ENDED));
        assertEquals(ExhibitorExhibition.STATUS_ENDED, ExhibitionManager.findById(id).getStatus());

        // Ended → Open (reopen)
        assertTrue(ExhibitionManager.updateStatus(id, ExhibitorExhibition.STATUS_OPEN));
        assertEquals(ExhibitorExhibition.STATUS_OPEN, ExhibitionManager.findById(id).getStatus());
        assertTrue(ExhibitionManager.findById(id).isOpenForRegistration());
    }

    // ── Multiple exhibitions managed independently ────────────────

    @Test
    public void multipleExhibitionsManagedIndependently() {
        // Create three exhibitions
        ExhibitorExhibition ex1 = ExhibitionManager.add(
                1, "展会A", "场馆A", "09:00", ExhibitorExhibition.STATUS_OPEN, "描述A", "分类A");
        ExhibitorExhibition ex2 = ExhibitionManager.add(
                2, "展会B", "场馆B", "10:00", ExhibitorExhibition.STATUS_OPEN, "描述B", "分类B");
        ExhibitorExhibition ex3 = ExhibitionManager.add(
                3, "展会C", "场馆C", "11:00", ExhibitorExhibition.STATUS_OPEN, "描述C", "分类C");

        assertEquals(3, ExhibitionManager.listAll().size());

        // Edit only the second one
        assertTrue(ExhibitionManager.update(ex2.getId(),
                22, "展会B-修改", "场馆B-修改", "14:00",
                ExhibitorExhibition.STATUS_CLOSED, "新描述", "新分类"));

        // Verify first and third unchanged
        assertEquals("展会A", ExhibitionManager.findById(ex1.getId()).getTitle());
        assertEquals("展会C", ExhibitionManager.findById(ex3.getId()).getTitle());

        // Delete the first
        assertTrue(ExhibitionManager.delete(ex1.getId()));
        assertEquals(2, ExhibitionManager.listAll().size());
        assertNull(ExhibitionManager.findById(ex1.getId()));

        // Verify remaining
        assertNotNull(ExhibitionManager.findById(ex2.getId()));
        assertNotNull(ExhibitionManager.findById(ex3.getId()));
        assertEquals("展会B-修改", ExhibitionManager.findById(ex2.getId()).getTitle());
    }

    // ── Create with registration records ──────────────────────────

    @Test
    public void exhibitionRegistrationRecordsAvailableAfterCreation() {
        ExhibitorExhibition ex = ExhibitionManager.add(
                1, "华南智能家居展", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        List<String> records = ExhibitionManager.getRegistrationRecords(ex);
        assertNotNull(records);
        // Smart home exhibition gets extra records (5 total)
        assertEquals(5, records.size());
    }

    // ── Delete then verify cannot be found or re-deleted ──────────

    @Test
    public void deleteThenVerifyNotFoundAndCannotReDelete() {
        ExhibitorExhibition ex = ExhibitionManager.add(
                1, "临时展", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        String id = ex.getId();

        assertTrue(ExhibitionManager.delete(id));
        assertNull(ExhibitionManager.findById(id));
        // Re-delete returns false
        assertFalse(ExhibitionManager.delete(id));
    }

    // ── Edit nonexistent returns false ────────────────────────────

    @Test
    public void editNonexistentExhibitionReturnsFalse() {
        assertFalse(ExhibitionManager.update("nonexistent",
                1, "t", "v", "t", ExhibitorExhibition.STATUS_OPEN, "d", "c"));
    }

    // ── Update status on nonexistent returns false ────────────────

    @Test
    public void updateStatusOnNonexistentReturnsFalse() {
        assertFalse(ExhibitionManager.updateStatus("nonexistent", ExhibitorExhibition.STATUS_CLOSED));
    }
}
