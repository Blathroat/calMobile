package com.example.calmobile;

/** Stable, view-free contract for the main shell's four tabs. */
final class MainTabState {

    static final int TAB_HOME = 0;
    static final int TAB_PROFILE = 1;
    static final int TAB_EXHIBITOR = 2;
    static final int TAB_ADMIN = 3;
    static final int TAB_COUNT = 4;

    private static final int[] NAV_TO_TAB = {
            TAB_HOME, TAB_EXHIBITOR, TAB_ADMIN, TAB_PROFILE
    };

    private MainTabState() {
    }

    static int tabForNavigationIndex(int navigationIndex) {
        if (navigationIndex < 0 || navigationIndex >= NAV_TO_TAB.length) {
            return TAB_HOME;
        }
        return NAV_TO_TAB[navigationIndex];
    }

    static boolean isValidTab(int tabIndex) {
        return tabIndex >= TAB_HOME && tabIndex < TAB_COUNT;
    }
}
