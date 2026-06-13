package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class ExhibitorExhibitionTest {

    private ExhibitorExhibition createExhibition() {
        return new ExhibitorExhibition("exh-1", 8, "华南智能家居展",
                "深圳会展中心 3 号馆", "09:00-17:30",
                ExhibitorExhibition.STATUS_OPEN, "智能门锁展示。", "智能家居");
    }

    // --- Status constants ---

    @Test
    public void statusConstantsAreDistinct() {
        assertFalse(ExhibitorExhibition.STATUS_OPEN.equals(ExhibitorExhibition.STATUS_CLOSED));
        assertFalse(ExhibitorExhibition.STATUS_OPEN.equals(ExhibitorExhibition.STATUS_ENDED));
        assertFalse(ExhibitorExhibition.STATUS_CLOSED.equals(ExhibitorExhibition.STATUS_ENDED));
    }

    @Test
    public void statusConstantsHaveExpectedValues() {
        assertEquals("报名中", ExhibitorExhibition.STATUS_OPEN);
        assertEquals("截止报名", ExhibitorExhibition.STATUS_CLOSED);
        assertEquals("已结束", ExhibitorExhibition.STATUS_ENDED);
    }

    // --- Constructor / getters ---

    @Test
    public void constructorSetsAllFields() {
        ExhibitorExhibition ex = createExhibition();

        assertEquals("exh-1", ex.getId());
        assertEquals(8, ex.getDay());
        assertEquals("华南智能家居展", ex.getTitle());
        assertEquals("深圳会展中心 3 号馆", ex.getVenue());
        assertEquals("09:00-17:30", ex.getTime());
        assertEquals(ExhibitorExhibition.STATUS_OPEN, ex.getStatus());
        assertEquals("智能门锁展示。", ex.getDescription());
        assertEquals("智能家居", ex.getCategory());
    }

    // --- Setters ---

    @Test
    public void setDayUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setDay(15);
        assertEquals(15, ex.getDay());
    }

    @Test
    public void setTitleUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setTitle("新标题");
        assertEquals("新标题", ex.getTitle());
    }

    @Test
    public void setVenueUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setVenue("新场馆");
        assertEquals("新场馆", ex.getVenue());
    }

    @Test
    public void setTimeUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setTime("14:00-20:00");
        assertEquals("14:00-20:00", ex.getTime());
    }

    @Test
    public void setStatusUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setStatus(ExhibitorExhibition.STATUS_CLOSED);
        assertEquals(ExhibitorExhibition.STATUS_CLOSED, ex.getStatus());
    }

    @Test
    public void setDescriptionUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setDescription("新描述");
        assertEquals("新描述", ex.getDescription());
    }

    @Test
    public void setCategoryUpdatesValue() {
        ExhibitorExhibition ex = createExhibition();
        ex.setCategory("新分类");
        assertEquals("新分类", ex.getCategory());
    }

    // --- isOpenForRegistration ---

    @Test
    public void isOpenForRegistrationWhenStatusIsOpen() {
        ExhibitorExhibition ex = createExhibition();
        assertTrue(ex.isOpenForRegistration());
    }

    @Test
    public void isNotOpenForRegistrationWhenStatusIsClosed() {
        ExhibitorExhibition ex = createExhibition();
        ex.setStatus(ExhibitorExhibition.STATUS_CLOSED);
        assertFalse(ex.isOpenForRegistration());
    }

    @Test
    public void isNotOpenForRegistrationWhenStatusIsEnded() {
        ExhibitorExhibition ex = createExhibition();
        ex.setStatus(ExhibitorExhibition.STATUS_ENDED);
        assertFalse(ex.isOpenForRegistration());
    }

    @Test
    public void isNotOpenForRegistrationWhenStatusIsNull() {
        ExhibitorExhibition ex = new ExhibitorExhibition("exh-1", 1, "t", "v", "t", null, "d", "c");
        assertFalse(ex.isOpenForRegistration());
    }

    // --- Edge cases ---

    @Test
    public void idIsImmutable() {
        ExhibitorExhibition ex = createExhibition();
        assertEquals("exh-1", ex.getId());
        // No setter for id — value should remain the same
        assertEquals("exh-1", ex.getId());
    }

    @Test
    public void settersAcceptNull() {
        ExhibitorExhibition ex = createExhibition();
        ex.setTitle(null);
        assertNull(ex.getTitle());
        ex.setVenue(null);
        assertNull(ex.getVenue());
        ex.setTime(null);
        assertNull(ex.getTime());
        ex.setStatus(null);
        assertNull(ex.getStatus());
        ex.setDescription(null);
        assertNull(ex.getDescription());
        ex.setCategory(null);
        assertNull(ex.getCategory());
    }

    @Test
    public void constructorAcceptsNullFields() {
        ExhibitorExhibition ex = new ExhibitorExhibition("exh-null", 0, null, null, null, null, null, null);
        assertEquals("exh-null", ex.getId());
        assertEquals(0, ex.getDay());
        assertNull(ex.getTitle());
        assertNull(ex.getVenue());
        assertNull(ex.getTime());
        assertNull(ex.getStatus());
        assertNull(ex.getDescription());
        assertNull(ex.getCategory());
    }
}
