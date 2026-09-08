package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class MainTabStateTest {

    @Test
    public void navigationIndexMapsToExpectedTab() {
        assertEquals(MainTabState.TAB_HOME, MainTabState.tabForNavigationIndex(0));
        assertEquals(MainTabState.TAB_EXHIBITOR, MainTabState.tabForNavigationIndex(1));
        assertEquals(MainTabState.TAB_ADMIN, MainTabState.tabForNavigationIndex(2));
        assertEquals(MainTabState.TAB_PROFILE, MainTabState.tabForNavigationIndex(3));
    }

    @Test
    public void invalidNavigationIndexFallsBackToHome() {
        assertEquals(MainTabState.TAB_HOME, MainTabState.tabForNavigationIndex(-1));
        assertEquals(MainTabState.TAB_HOME, MainTabState.tabForNavigationIndex(4));
    }

    @Test
    public void tabIndexIsValidOnlyWithinTheFourTabContract() {
        assertTrue(MainTabState.isValidTab(MainTabState.TAB_HOME));
        assertTrue(MainTabState.isValidTab(MainTabState.TAB_PROFILE));
        assertEquals(4, MainTabState.TAB_COUNT);
    }
}
