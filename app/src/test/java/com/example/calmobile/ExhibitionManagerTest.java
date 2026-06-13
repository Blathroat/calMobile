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

public class ExhibitionManagerTest {

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

    // --- ensureInitialized ---

    @Test
    public void ensureInitializedSeedsSampleData() {
        ExhibitionManager.ensureInitialized();

        List<ExhibitorExhibition> list = ExhibitionManager.listAll();
        assertEquals(4, list.size());
    }

    @Test
    public void ensureInitializedIsIdempotent() {
        ExhibitionManager.ensureInitialized();
        ExhibitionManager.ensureInitialized();

        List<ExhibitorExhibition> list = ExhibitionManager.listAll();
        assertEquals(4, list.size());
    }

    @Test
    public void initializedExhibitionsHaveCorrectStatuses() {
        ExhibitionManager.ensureInitialized();

        List<ExhibitorExhibition> list = ExhibitionManager.listAll();
        assertEquals(ExhibitorExhibition.STATUS_OPEN, list.get(0).getStatus());
        assertEquals(ExhibitorExhibition.STATUS_OPEN, list.get(1).getStatus());
        assertEquals(ExhibitorExhibition.STATUS_CLOSED, list.get(2).getStatus());
        assertEquals(ExhibitorExhibition.STATUS_ENDED, list.get(3).getStatus());
    }

    // --- add ---

    @Test
    public void addCreatesExhibitionWithAutoId() {
        ExhibitorExhibition ex = ExhibitionManager.add(1, "测试展", "场馆", "09:00-17:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        assertNotNull(ex);
        assertEquals("exh-1", ex.getId());
        assertEquals("测试展", ex.getTitle());
    }

    @Test
    public void addIncrementsIdAutomatically() {
        ExhibitorExhibition first = ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");
        ExhibitorExhibition second = ExhibitionManager.add(2, "展2", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        assertEquals("exh-1", first.getId());
        assertEquals("exh-2", second.getId());
    }

    @Test
    public void addIncreasesListSize() {
        assertEquals(0, ExhibitionManager.listAll().size());

        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");
        assertEquals(1, ExhibitionManager.listAll().size());

        ExhibitionManager.add(2, "展2", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");
        assertEquals(2, ExhibitionManager.listAll().size());
    }

    // --- listAll ---

    @Test
    public void listAllReturnsEmptyListWhenNoExhibitions() {
        List<ExhibitorExhibition> list = ExhibitionManager.listAll();
        assertTrue(list.isEmpty());
    }

    @Test
    public void listAllReturnsCopy() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        List<ExhibitorExhibition> list = ExhibitionManager.listAll();
        list.clear();

        assertEquals(1, ExhibitionManager.listAll().size());
    }

    // --- findById ---

    @Test
    public void findByIdReturnsExhibition() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        ExhibitorExhibition found = ExhibitionManager.findById("exh-1");
        assertNotNull(found);
        assertEquals("展1", found.getTitle());
    }

    @Test
    public void findByIdReturnsNullForMissingId() {
        assertNull(ExhibitionManager.findById("nonexistent"));
    }

    @Test
    public void findByIdReturnsNullForNullId() {
        assertNull(ExhibitionManager.findById(null));
    }

    // --- update ---

    @Test
    public void updateModifiesAllFields() {
        ExhibitionManager.add(1, "原标题", "原场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "原描述", "原分类");

        boolean result = ExhibitionManager.update("exh-1",
                10, "新标题", "新场馆", "14:00",
                ExhibitorExhibition.STATUS_CLOSED, "新描述", "新分类");

        assertTrue(result);
        ExhibitorExhibition updated = ExhibitionManager.findById("exh-1");
        assertEquals(10, updated.getDay());
        assertEquals("新标题", updated.getTitle());
        assertEquals("新场馆", updated.getVenue());
        assertEquals("14:00", updated.getTime());
        assertEquals(ExhibitorExhibition.STATUS_CLOSED, updated.getStatus());
        assertEquals("新描述", updated.getDescription());
        assertEquals("新分类", updated.getCategory());
    }

    @Test
    public void updateReturnsFalseForMissingId() {
        assertFalse(ExhibitionManager.update("nonexistent",
                1, "t", "v", "t", ExhibitorExhibition.STATUS_OPEN, "d", "c"));
    }

    // --- delete ---

    @Test
    public void deleteRemovesExhibition() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        assertTrue(ExhibitionManager.delete("exh-1"));
        assertEquals(0, ExhibitionManager.listAll().size());
        assertNull(ExhibitionManager.findById("exh-1"));
    }

    @Test
    public void deleteReturnsFalseForMissingId() {
        assertFalse(ExhibitionManager.delete("nonexistent"));
    }

    @Test
    public void deleteDoesNotAffectOtherExhibitions() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");
        ExhibitionManager.add(2, "展2", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        ExhibitionManager.delete("exh-1");

        assertEquals(1, ExhibitionManager.listAll().size());
        assertNotNull(ExhibitionManager.findById("exh-2"));
    }

    // --- updateStatus ---

    @Test
    public void updateStatusChangesStatus() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        assertTrue(ExhibitionManager.updateStatus("exh-1", ExhibitorExhibition.STATUS_CLOSED));
        assertEquals(ExhibitorExhibition.STATUS_CLOSED,
                ExhibitionManager.findById("exh-1").getStatus());
    }

    @Test
    public void updateStatusReturnsFalseForMissingId() {
        assertFalse(ExhibitionManager.updateStatus("nonexistent", ExhibitorExhibition.STATUS_CLOSED));
    }

    @Test
    public void updateStatusCanTransitionThroughAllStates() {
        ExhibitionManager.add(1, "展1", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        ExhibitionManager.updateStatus("exh-1", ExhibitorExhibition.STATUS_CLOSED);
        assertEquals(ExhibitorExhibition.STATUS_CLOSED,
                ExhibitionManager.findById("exh-1").getStatus());

        ExhibitionManager.updateStatus("exh-1", ExhibitorExhibition.STATUS_ENDED);
        assertEquals(ExhibitorExhibition.STATUS_ENDED,
                ExhibitionManager.findById("exh-1").getStatus());

        ExhibitionManager.updateStatus("exh-1", ExhibitorExhibition.STATUS_OPEN);
        assertEquals(ExhibitorExhibition.STATUS_OPEN,
                ExhibitionManager.findById("exh-1").getStatus());
    }

    // --- getRegistrationRecords ---

    @Test
    public void getRegistrationRecordsReturnsBaseRecords() {
        ExhibitorExhibition ex = ExhibitionManager.add(1, "普通展会", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        List<String> records = ExhibitionManager.getRegistrationRecords(ex);
        assertEquals(3, records.size());
    }

    @Test
    public void getRegistrationRecordsReturnsExtraForSmartExhibition() {
        ExhibitorExhibition ex = ExhibitionManager.add(1, "华南智能家居展", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        List<String> records = ExhibitionManager.getRegistrationRecords(ex);
        assertEquals(5, records.size());
    }

    @Test
    public void getRegistrationRecordsReturnsExtraForLogisticsExhibition() {
        ExhibitorExhibition ex = ExhibitionManager.add(1, "大湾区物流技术展", "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");

        List<String> records = ExhibitionManager.getRegistrationRecords(ex);
        assertEquals(4, records.size());
    }

    // --- Edge cases ---

    @Test
    public void addWithNullTitle() {
        ExhibitorExhibition ex = ExhibitionManager.add(1, null, "v", "t",
                ExhibitorExhibition.STATUS_OPEN, "d", "c");
        assertNull(ex.getTitle());
        assertNotNull(ex.getId());
    }

    @Test
    public void findByIdWithEmptyString() {
        assertNull(ExhibitionManager.findById(""));
    }
}
