package com.example.calmobile;

import com.example.calmobile.ExportManager;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.AnimationUtils;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Main shell activity with in-place bottom navigation.
 * Tabs (Home / Profile / Exhibitor / Admin) switch content inside a
 * single FrameLayout with left/right slide animations.
 */
public class MainActivity extends BaseActivity {

    // ── Tab constants ─────────────────────────────────────────────
    private static final int TAB_HOME = 0;
    private static final int TAB_PROFILE = 1;
    private static final int TAB_EXHIBITOR = 2;
    private static final int TAB_ADMIN = 3;
    private static final int TAB_COUNT = 4;

    private static final int[] NAV_IDS = {
            R.id.nav_home, R.id.nav_profile, R.id.nav_exhibitor, R.id.nav_admin
    };
    private static final int[] NAV_TEXT_IDS = {
            R.id.nav_home_text, R.id.nav_profile_text, R.id.nav_exhibitor_text, R.id.nav_admin_text
    };
    private static final int[] NAV_ICON_IDS = {
            R.id.nav_home_icon, R.id.nav_profile_icon, R.id.nav_exhibitor_icon, R.id.nav_admin_icon
    };

    // ── State ─────────────────────────────────────────────────────
    private int currentTab = TAB_HOME;
    private final View[] tabViews = new View[TAB_COUNT];
    private FrameLayout contentFrame;

    // ── Home tab fields ───────────────────────────────────────────
    private static final int MONTH_DAYS = 30;
    private int currentYear = 2026;
    private int currentMonth = 6; // 1-12
    private static final Exhibition[] SAMPLE_EXHIBITIONS = new Exhibition[] {
            new Exhibition(6, "华南智能制造展", "深圳国际会展中心 6 号馆",
                    "09:30-17:00", "报名中", true,
                    "聚焦工业机器人、柔性产线和数字化工厂方案，适合制造业采购与技术负责人参观。",
                    "智能制造 / 工业自动化"),
            new Exhibition(12, "绿色能源装备展", "广州琶洲展馆 A 区",
                    "10:00-18:00", "报名中", true,
                    "展示储能、电池回收、光伏逆变器和低碳园区方案，现场开放采购对接区。",
                    "新能源 / 储能"),
            new Exhibition(12, "跨境电商选品会", "广州琶洲展馆 B 区",
                    "13:30-20:00", "席位紧张", true,
                    "本地假数据演示：用当天多场展会验证列表、详情和报名表单切换流程。",
                    "电商 / 选品"),
            new Exhibition(21, "城市更新材料展", "上海新国际博览中心",
                    "09:00-16:30", "报名截止", false,
                    "面向建筑材料、节能门窗和旧改服务商的专业展，当前样例设置为不可报名状态。",
                    "建筑材料 / 城市更新")
    };
    private TextView homeStatusText;
    private TextView monthTitleText;
    private GridLayout homeCalendarGrid;
    private LinearLayout homeExhibitionList;
    private LinearLayout homeRegistrationsList;
    private final RegistrationManager registrationManager = new RegistrationManager();

    // ── Exhibitor tab fields ──────────────────────────────────────
    private LinearLayout exhListContainer;
    private LinearLayout exhFormContainer;

    // ── Admin tab fields ──────────────────────────────────────────
    private static final int ADMIN_TAB_USERS = 0;
    private static final int ADMIN_TAB_EXHIBITIONS = 1;
    private static final int ADMIN_TAB_SETTINGS = 2;
    private int adminCurrentSubTab = ADMIN_TAB_USERS;

    // ══════════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════════

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        contentFrame = findViewById(R.id.content_frame);
        NotificationHelper.getInstance(this).requestNotificationPermission(this);

        showTab(TAB_HOME, false);
        setupBottomNav();
        applyRoleVisibility();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ══════════════════════════════════════════════════════════════
    // Tab switching with slide animations
    // ══════════════════════════════════════════════════════════════

    private void showTab(int tabIndex, boolean animate) {
        if (!canAccessTab(tabIndex)) {
            showAccessDeniedForTab(tabIndex);
            tabIndex = TAB_HOME;
            animate = false;
        }

        if (tabIndex == currentTab && contentFrame.getChildCount() > 0) {
            return;
        }

        View newView = getOrCreateTabView(tabIndex);
        View oldView = contentFrame.getChildCount() > 0
                ? contentFrame.getChildAt(0) : null;

        if (animate && oldView != null) {
            boolean movingRight = tabIndex > currentTab;
            Animation exitAnim = AnimationUtils.loadAnimation(this,
                    movingRight ? R.anim.slide_out_left : R.anim.slide_out_right);
            Animation enterAnim = AnimationUtils.loadAnimation(this,
                    movingRight ? R.anim.slide_in_right : R.anim.slide_in_left);

            contentFrame.addView(newView, 0);
            oldView.bringToFront();
            oldView.startAnimation(exitAnim);
            newView.startAnimation(enterAnim);

            final View removeTarget = oldView;
            exitAnim.setAnimationListener(new Animation.AnimationListener() {
                @Override
                public void onAnimationStart(Animation animation) { }
                @Override
                public void onAnimationRepeat(Animation animation) { }
                @Override
                public void onAnimationEnd(Animation animation) {
                    contentFrame.removeView(removeTarget);
                }
            });
        } else {
            contentFrame.removeAllViews();
            contentFrame.addView(newView);
        }

        currentTab = tabIndex;
        updateNavHighlight();
    }

    private View getOrCreateTabView(int tabIndex) {
        if (tabViews[tabIndex] == null) {
            tabViews[tabIndex] = buildTabContent(tabIndex);
        }
        return tabViews[tabIndex];
    }

    private View buildTabContent(int tabIndex) {
        switch (tabIndex) {
            case TAB_HOME:      return buildHomeContent();
            case TAB_PROFILE:   return buildProfileContent();
            case TAB_EXHIBITOR: return buildExhibitorContent();
            case TAB_ADMIN:     return buildAdminContent();
            default:            return new View(this);
        }
    }

    /** Force-refresh a tab's content on next visit. */
    private void invalidateTab(int tabIndex) {
        tabViews[tabIndex] = null;
    }

    // ══════════════════════════════════════════════════════════════
    // Bottom nav setup & highlight
    // ══════════════════════════════════════════════════════════════

    private void setupBottomNav() {
        for (int i = 0; i < NAV_IDS.length; i++) {
            final int idx = i;
            findViewById(NAV_IDS[i]).setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (!canAccessTab(idx)) {
                        showAccessDeniedForTab(idx);
                        return;
                    }
                    showTab(idx, true);
                }
            });
        }
        updateNavHighlight();
    }

    private void updateNavHighlight() {
        for (int i = 0; i < NAV_IDS.length; i++) {
            View item = findViewById(NAV_IDS[i]);
            TextView text = findViewById(NAV_TEXT_IDS[i]);
            ImageView icon = findViewById(NAV_ICON_IDS[i]);
            boolean active = (i == currentTab);
            item.setSelected(active);
            text.setTextColor(getResources().getColor(
                    active ? R.color.nav_active_text : R.color.nav_inactive_text));
            icon.setColorFilter(getResources().getColor(
                    active ? R.color.nav_active_icon : R.color.nav_inactive_icon));
        }
    }

    private void applyRoleVisibility() {
        AuthManager auth = AuthManager.getInstance();
        boolean showProfile = auth.canAccessProfile();
        boolean showExhibitor = auth.canAccessExhibitor();
        boolean showAdmin = auth.canAccessAdmin();

        findViewById(R.id.nav_profile).setVisibility(
                showProfile ? View.VISIBLE : View.GONE);
        findViewById(R.id.nav_exhibitor).setVisibility(
                showExhibitor ? View.VISIBLE : View.GONE);
        findViewById(R.id.nav_admin).setVisibility(
                showAdmin ? View.VISIBLE : View.GONE);

        if ((currentTab == TAB_PROFILE && !showProfile)
                || (currentTab == TAB_EXHIBITOR && !showExhibitor)
                || (currentTab == TAB_ADMIN && !showAdmin)) {
            showTab(TAB_HOME, false);
        }
    }

    private boolean canAccessTab(int tabIndex) {
        AuthManager auth = AuthManager.getInstance();
        switch (tabIndex) {
            case TAB_PROFILE:
                return auth.canAccessProfile();
            case TAB_EXHIBITOR:
                return auth.canAccessExhibitor();
            case TAB_ADMIN:
                return auth.canAccessAdmin();
            default:
                return true;
        }
    }

    private void showAccessDeniedForTab(int tabIndex) {
        int messageRes = R.string.auth_login_required_profile;
        if (tabIndex == TAB_EXHIBITOR) {
            messageRes = R.string.auth_exhibitor_required;
        } else if (tabIndex == TAB_ADMIN) {
            messageRes = R.string.auth_admin_required;
        }
        Toast.makeText(this, messageRes, Toast.LENGTH_SHORT).show();
    }

    // ══════════════════════════════════════════════════════════════
    // Home content
    // ══════════════════════════════════════════════════════════════

    private ScrollView buildHomeContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        // Header
        addText(root, getString(R.string.app_name), R.color.text_primary, 22, Typeface.BOLD);
        homeStatusText = addText(root, getString(R.string.home_status),
                R.color.text_secondary, 14, Typeface.NORMAL);

        // Search bar
        LinearLayout searchBar = new LinearLayout(this);
        searchBar.setOrientation(LinearLayout.HORIZONTAL);
        searchBar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        searchBar.setPadding(dp(16), 0, dp(16), 0);
        styleSearchBar(searchBar);
        searchBar.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                navigateTo(SearchActivity.class);
            }
        });
        TextView hint = new TextView(this);
        hint.setText(R.string.search_hint);
        hint.setTextColor(getResources().getColor(R.color.text_hint));
        hint.setTextSize(14);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        searchBar.addView(hint, hintParams);
        ImageView searchIcon = new ImageView(this);
        searchIcon.setImageResource(android.R.drawable.ic_menu_search);
        searchIcon.setColorFilter(getResources().getColor(R.color.text_tertiary));
        searchBar.addView(searchIcon, new LinearLayout.LayoutParams(dp(24), dp(24)));
        root.addView(searchBar, fullWidthParams(16));

        // Calendar section
        LinearLayout calCard = new LinearLayout(this);
        calCard.setOrientation(LinearLayout.VERTICAL);
        calCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(calCard);
        final float[] touchX = new float[1];
        calCard.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, android.view.MotionEvent event) {
                switch (event.getAction()) {
                    case android.view.MotionEvent.ACTION_DOWN:
                        touchX[0] = event.getX();
                        return true;
                    case android.view.MotionEvent.ACTION_UP:
                        float dx = event.getX() - touchX[0];
                        if (Math.abs(dx) > 100) {
                            if (dx > 0) {
                                prevMonth();
                            } else {
                                nextMonth();
                            }
                            return true;
                        }
                        return false;
                }
                return false;
            }
        });

        LinearLayout monthNav = new LinearLayout(this);
        monthNav.setOrientation(LinearLayout.HORIZONTAL);
        monthNav.setGravity(android.view.Gravity.CENTER_VERTICAL);

        Button prevBtn = new Button(this);
        prevBtn.setAllCaps(false);
        prevBtn.setText("◀");
        prevBtn.setTextSize(18);
        prevBtn.setTextColor(getResources().getColor(R.color.text_primary));
        prevBtn.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        prevBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                prevMonth();
            }
        });
        monthNav.addView(prevBtn, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        monthTitleText = new TextView(this);
        monthTitleText.setText(currentYear + "年" + currentMonth + "月");
        monthTitleText.setTextColor(getResources().getColor(R.color.text_primary));
        monthTitleText.setTextSize(17);
        monthTitleText.setTypeface(Typeface.DEFAULT_BOLD);
        monthTitleText.setGravity(android.view.Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        monthNav.addView(monthTitleText, titleParams);

        Button nextBtn = new Button(this);
        nextBtn.setAllCaps(false);
        nextBtn.setText("▶");
        nextBtn.setTextSize(18);
        nextBtn.setTextColor(getResources().getColor(R.color.text_primary));
        nextBtn.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        nextBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                nextMonth();
            }
        });
        monthNav.addView(nextBtn, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        calCard.addView(monthNav, fullWidthParams(4));
        homeCalendarGrid = new GridLayout(this);
        homeCalendarGrid.setColumnCount(7);
        homeCalendarGrid.setRowCount((getDaysInMonth(currentYear, currentMonth) + 6) / 7);
        homeCalendarGrid.setAlignmentMode(GridLayout.ALIGN_MARGINS);
        calCard.addView(homeCalendarGrid, fullWidthParams(12));
        root.addView(calCard, fullWidthParams(28));

        // Today's exhibitions
        addText(root, getString(R.string.today_exhibitions),
                R.color.text_primary, 17, Typeface.BOLD);

        if (AuthManager.getInstance().canAccessExhibitor()) {
            LinearLayout exportRow = new LinearLayout(this);
            exportRow.setOrientation(LinearLayout.HORIZONTAL);

            Button exportExhBtn = new Button(this);
            styleSecondaryButton(exportExhBtn);
            exportExhBtn.setText(R.string.export_exhibitions);
            exportExhBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    String path = ExportManager.exportExhibitions(MainActivity.this);
                    if (path != null) {
                        Toast.makeText(MainActivity.this,
                                getString(R.string.export_success, path),
                                Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(MainActivity.this,
                                R.string.export_empty, Toast.LENGTH_SHORT).show();
                    }
                }
            });
            LinearLayout.LayoutParams exhParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            exhParams.setMargins(0, 0, dp(4), 0);
            exportRow.addView(exportExhBtn, exhParams);

            Button exportRegBtn = new Button(this);
            styleSecondaryButton(exportRegBtn);
            exportRegBtn.setText(R.string.export_registrations);
            exportRegBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    String path = ExportManager.exportRegistrations(MainActivity.this);
                    if (path != null) {
                        Toast.makeText(MainActivity.this,
                                getString(R.string.export_success, path),
                                Toast.LENGTH_LONG).show();
                    } else {
                        Toast.makeText(MainActivity.this,
                                R.string.export_empty, Toast.LENGTH_SHORT).show();
                    }
                }
            });
            LinearLayout.LayoutParams regParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            regParams.setMargins(dp(4), 0, 0, 0);
            exportRow.addView(exportRegBtn, regParams);

            root.addView(exportRow, fullWidthParams(8));
        }

        homeExhibitionList = new LinearLayout(this);
        homeExhibitionList.setOrientation(LinearLayout.VERTICAL);
        root.addView(homeExhibitionList, fullWidthParams(8));

        // My registrations
        addText(root, getString(R.string.my_registrations_title),
                R.color.text_primary, 17, Typeface.BOLD);
        homeRegistrationsList = new LinearLayout(this);
        homeRegistrationsList.setOrientation(LinearLayout.VERTICAL);
        root.addView(homeRegistrationsList, fullWidthParams(8));

        // Build data
        buildMonthGrid(getDaysInMonth(currentYear, currentMonth));
        showExhibitionsForDay(12);
        renderMyRegistrations();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void styleSearchBar(LinearLayout bar) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        bar.setBackground(bg);
        bar.setElevation(dp(2));
        bar.setClickable(true);
        bar.setFocusable(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(48));
        bar.setLayoutParams(params);
    }

    // ── Calendar grid ─────────────────────────────────────────────

    private void buildMonthGrid(int daysInMonth) {
        homeCalendarGrid.removeAllViews();
        for (int day = 1; day <= daysInMonth; day++) {
            final int selectedDay = day;
            int count = countExhibitionsForDay(day);
            Button dayButton = new Button(this);
            dayButton.setAllCaps(false);
            dayButton.setText(count > 0 ? day + "\n" + count + "场" : String.valueOf(day));
            dayButton.setTextColor(getResources().getColor(
                    count > 0 ? R.color.date_active_text : R.color.text_secondary));
            dayButton.setTextSize(12);
            dayButton.setTypeface(Typeface.DEFAULT,
                    count > 0 ? Typeface.BOLD : Typeface.NORMAL);

            GradientDrawable cellBg = new GradientDrawable();
            cellBg.setCornerRadius(dp(8));
            if (count > 0) {
                cellBg.setColor(getResources().getColor(R.color.date_active_background));
                cellBg.setStroke(dp(1), getResources().getColor(R.color.chip_border));
            } else {
                cellBg.setColor(getResources().getColor(R.color.card_background));
                cellBg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
            }
            dayButton.setBackground(cellBg);
            dayButton.setPadding(0, dp(6), 0, dp(6));
            dayButton.setGravity(android.view.Gravity.CENTER);
            dayButton.setIncludeFontPadding(false);
            dayButton.setMinHeight(0);
            dayButton.setMinimumHeight(0);
            dayButton.setLineSpacing(0, 1.0f);
            dayButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showExhibitionsForDay(selectedDay);
                }
            });

            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(56);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(2), dp(2), dp(2), dp(2));
            homeCalendarGrid.addView(dayButton, params);
        }
    }

    private void prevMonth() {
        currentMonth--;
        if (currentMonth < 1) {
            currentMonth = 12;
            currentYear--;
        }
        updateMonthDisplay();
    }

    private void nextMonth() {
        currentMonth++;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        }
        updateMonthDisplay();
    }

    private void updateMonthDisplay() {
        monthTitleText.setText(currentYear + "年" + currentMonth + "月");
        int daysInMonth = getDaysInMonth(currentYear, currentMonth);
        homeCalendarGrid.setRowCount((daysInMonth + 6) / 7);
        buildMonthGrid(daysInMonth);
        showExhibitionsForDay(1);
    }

    private int getDaysInMonth(int year, int month) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.set(year, month - 1, 1);
        return cal.getActualMaximum(java.util.Calendar.DAY_OF_MONTH);
    }

    // ── Exhibition list for a day ─────────────────────────────────

    private void showExhibitionsForDay(int day) {
        homeExhibitionList.removeAllViews();
        List<Exhibition> exhibitions = getExhibitionsForDay(day);
        homeStatusText.setText(getString(R.string.local_day_count, day, exhibitions.size()));

        if (exhibitions.isEmpty()) {
            showEmptyState(homeExhibitionList, getString(R.string.empty_exhibitions_day));
            return;
        }

        for (final Exhibition exhibition : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);
            applyRippleBackground(card);
            card.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openExhibitionDetail(exhibition);
                }
            });

            addText(card, exhibition.title, R.color.text_primary, 18, Typeface.BOLD);
            addText(card, exhibition.time + " · " + exhibition.venue,
                    R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, exhibition.status + " · " + exhibition.category,
                    exhibition.openForRegistration
                            ? R.color.status_open : R.color.status_closed,
                    14, Typeface.BOLD);

            Button detailButton = new Button(this);
            styleSecondaryButton(detailButton);
            detailButton.setText(R.string.exhibition_detail);
            detailButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openExhibitionDetail(exhibition);
                }
            });
            card.addView(detailButton, fullWidthParams(8));

            Button publicProfileButton = new Button(this);
            styleSecondaryButton(publicProfileButton);
            publicProfileButton.setText(R.string.user_public_view_profile_hint);
            publicProfileButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openUserPublicProfile();
                }
            });
            card.addView(publicProfileButton, fullWidthParams(4));
            homeExhibitionList.addView(card, fullWidthParams(10));
        }
        animateListItems(homeExhibitionList, 100);
    }

    private void openUserPublicProfile() {
        Intent intent = new Intent(this, UserPublicActivity.class);
        intent.putExtra("nickname", getString(R.string.profile_default_nickname));
        intent.putExtra("bio", getString(R.string.profile_default_bio));
        intent.putExtra("contact", getString(R.string.profile_default_contact));
        intent.putExtra("socialMedia", getString(R.string.profile_default_social));
        intent.putExtra("showRegistrations", false);
        intent.putExtra("isOwnProfile", false);
        navigateTo(intent);
    }

    private void openExhibitionDetail(Exhibition exhibition) {
        Intent intent = new Intent(this, ExhibitionDetailActivity.class);
        intent.putExtra("day", exhibition.day);
        intent.putExtra("title", exhibition.title);
        intent.putExtra("venue", exhibition.venue);
        intent.putExtra("time", exhibition.time);
        intent.putExtra("status", exhibition.status);
        intent.putExtra("openForRegistration", exhibition.openForRegistration);
        intent.putExtra("description", exhibition.description);
        intent.putExtra("category", exhibition.category);
        navigateTo(intent);
    }

    // ── My registrations ──────────────────────────────────────────

    private void renderMyRegistrations() {
        homeRegistrationsList.removeAllViews();
        if (!AuthManager.getInstance().canAccessProfile()) {
            showEmptyState(homeRegistrationsList, getString(R.string.auth_login_required_profile));
            return;
        }
        List<Registration> registrations = registrationManager.list();

        if (registrations.isEmpty()) {
            showEmptyState(homeRegistrationsList, getString(R.string.my_registrations_empty));
            return;
        }

        for (final Registration reg : registrations) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            addText(card, reg.getExhibitionTitle(), R.color.text_primary, 16, Typeface.BOLD);
            addText(card, "6月" + reg.getExhibitionDay() + "日 "
                            + reg.getExhibitionTime() + " · " + reg.getExhibitionVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, reg.getVisitorName() + " · " + reg.getVisitorType(),
                    R.color.text_primary, 14, Typeface.NORMAL);

            String statusLabel = reg.getStatus() == Registration.Status.PENDING
                    ? getString(R.string.status_pending)
                    : getString(R.string.status_cancelled);
            addText(card, statusLabel + " · " + reg.getNeedsSummary(),
                    reg.getStatus() == Registration.Status.PENDING
                            ? R.color.status_open : R.color.status_closed,
                    14, Typeface.BOLD);

            final boolean isCancelled = reg.getStatus() == Registration.Status.CANCELLED;
            if (!isCancelled) {
                Button cancelButton = new Button(this);
                styleDangerButton(cancelButton);
                cancelButton.setText(R.string.cancel_registration);
                cancelButton.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        showConfirmDialog(
                                getString(R.string.confirm_cancel_registration),
                                new Runnable() {
                                    @Override
                                    public void run() {
                                        registrationManager.cancel(reg.getId());
                                        Toast.makeText(MainActivity.this,
                                                R.string.registration_cancelled,
                                                Toast.LENGTH_SHORT).show();
                                        renderMyRegistrations();
                                    }
                                });
                    }
                });
                card.addView(cancelButton, fullWidthParams(6));
            }
            homeRegistrationsList.addView(card, fullWidthParams(8));
        }
        animateListItems(homeRegistrationsList, 50);
    }

    // ── Ripple background helper ──────────────────────────────────

    private void applyRippleBackground(View view) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(getResources().getColor(R.color.card_background));
        shape.setCornerRadius(dp(12));
        shape.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        RippleDrawable ripple = new RippleDrawable(
                android.content.res.ColorStateList.valueOf(
                        getResources().getColor(R.color.ripple_color)),
                shape, null);
        view.setBackground(ripple);
    }

    // ══════════════════════════════════════════════════════════════
    // Profile content
    // ══════════════════════════════════════════════════════════════

    private ScrollView buildProfileContent() {
        final LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        renderProfileView(root);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void renderProfileView(final LinearLayout root) {
        root.removeAllViews();

        // Apply defaults if empty
        if (ProfileActivity.getProfileNickname().length() == 0) {
            ProfileActivity.setProfileNickname(getString(R.string.profile_default_nickname));
            ProfileActivity.setProfileBio(getString(R.string.profile_default_bio));
            ProfileActivity.setProfileContact(getString(R.string.profile_default_contact));
            ProfileActivity.setProfileSocialMedia(getString(R.string.profile_default_social));
        }

        final String nickname = ProfileActivity.getProfileNickname();
        final String bio = ProfileActivity.getProfileBio();
        final String contact = ProfileActivity.getProfileContact();
        final String social = ProfileActivity.getProfileSocialMedia();

        // Avatar + nickname card
        LinearLayout headerCard = new LinearLayout(this);
        headerCard.setOrientation(LinearLayout.VERTICAL);
        headerCard.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        headerCard.setPadding(dp(24), dp(24), dp(24), dp(24));
        styleCard(headerCard);

        TextView avatar = new TextView(this);
        avatar.setText(nickname.length() > 0
                ? nickname.substring(0, 1)
                : getString(R.string.profile_avatar_initial));
        avatar.setTextColor(getResources().getColor(R.color.avatar_text));
        avatar.setTextSize(28);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(android.view.Gravity.CENTER);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(getResources().getColor(R.color.avatar_bg));
        avatar.setBackground(circle);
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(72), dp(72));
        avatarParams.setMargins(0, dp(8), 0, dp(12));
        headerCard.addView(avatar, avatarParams);
        addText(headerCard, nickname, R.color.text_primary, 22, Typeface.BOLD);
        root.addView(headerCard, fullWidthParams(0));

        // Info card
        LinearLayout infoCard = new LinearLayout(this);
        infoCard.setOrientation(LinearLayout.VERTICAL);
        infoCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(infoCard);

        addText(infoCard, getString(R.string.profile_bio_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoCard, bio, R.color.text_primary, 16, Typeface.NORMAL);
        addDivider(infoCard);
        addText(infoCard, getString(R.string.profile_contact_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoCard, contact, R.color.text_primary, 16, Typeface.NORMAL);
        addDivider(infoCard);
        addText(infoCard, getString(R.string.profile_social_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoCard, social, R.color.text_primary, 16, Typeface.NORMAL);
        root.addView(infoCard, fullWidthParams(12));

        // Edit button
        Button editBtn = new Button(this);
        stylePrimaryButton(editBtn);
        editBtn.setText(R.string.profile_edit);
        editBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                navigateTo(ProfileActivity.class);
            }
        });
        root.addView(editBtn, fullWidthParams(12));

        // Notification settings card
        LinearLayout notifCard = new LinearLayout(this);
        notifCard.setOrientation(LinearLayout.VERTICAL);
        notifCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(notifCard);

        final NotificationHelper helper = NotificationHelper.getInstance(this);
        addText(notifCard, getString(R.string.notification_settings_title),
                R.color.text_primary, 17, Typeface.BOLD);

        final android.widget.CheckBox exhToggle = new android.widget.CheckBox(this);
        exhToggle.setText(R.string.notification_exhibition_reminder);
        exhToggle.setChecked(helper.isExhibitionReminderEnabled());
        exhToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                helper.setExhibitionReminderEnabled(exhToggle.isChecked());
                Toast.makeText(MainActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notifCard.addView(exhToggle, fullWidthParams(4));

        final android.widget.CheckBox regToggle = new android.widget.CheckBox(this);
        regToggle.setText(R.string.notification_registration_updates);
        regToggle.setChecked(helper.isRegistrationUpdatesEnabled());
        regToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                helper.setRegistrationUpdatesEnabled(regToggle.isChecked());
                Toast.makeText(MainActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notifCard.addView(regToggle, fullWidthParams(4));
        root.addView(notifCard, fullWidthParams(16));

        // Notification history card
        List<NotificationHelper.NotificationRecord> records = helper.getHistory();
        LinearLayout historyCard = new LinearLayout(this);
        historyCard.setOrientation(LinearLayout.VERTICAL);
        historyCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(historyCard);

        addText(historyCard, getString(R.string.notification_history_title),
                R.color.text_primary, 17, Typeface.BOLD);
        addText(historyCard,
                getString(R.string.notification_history_count, records.size()),
                R.color.text_secondary, 13, Typeface.NORMAL);

        if (records.isEmpty()) {
            addText(historyCard, getString(R.string.notification_history_empty),
                    R.color.text_secondary, 14, Typeface.NORMAL);
        } else {
            java.text.SimpleDateFormat sdf =
                    new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault());
            for (NotificationHelper.NotificationRecord rec : records) {
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(12), dp(8), dp(12), dp(8));
                GradientDrawable rowBg = new GradientDrawable();
                rowBg.setColor(getResources().getColor(R.color.surface_variant));
                rowBg.setCornerRadius(dp(8));
                row.setBackground(rowBg);
                addText(row, rec.type + " · " + sdf.format(new java.util.Date(rec.timestamp)),
                        R.color.text_secondary, 12, Typeface.NORMAL);
                addText(row, rec.relatedTitle, R.color.text_primary, 14, Typeface.BOLD);
                String preview = rec.message.length() > 60
                        ? rec.message.substring(0, 60) + "…" : rec.message;
                addText(row, preview, R.color.text_secondary, 13, Typeface.NORMAL);
                historyCard.addView(row, fullWidthParams(6));
            }
        }
        root.addView(historyCard, fullWidthParams(12));

        animateListItems(root, 80);
    }

    // ══════════════════════════════════════════════════════════════
    // Exhibitor content
    // ══════════════════════════════════════════════════════════════

    private ScrollView buildExhibitorContent() {
        ExhibitionManager.ensureInitialized();

        final LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        addText(root, getString(R.string.exhibitor_backend_title),
                R.color.text_primary, 22, Typeface.BOLD);

        // Add button
        Button addBtn = new Button(this);
        addBtn.setAllCaps(false);
        addBtn.setText(R.string.exhibitor_add_exhibition);
        stylePrimaryButton(addBtn);
        addBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                navigateTo(ExhibitorBackendActivity.class);
            }
        });
        root.addView(addBtn, fullWidthParams(16));

        // Exhibition list
        exhListContainer = new LinearLayout(this);
        exhListContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(exhListContainer, fullWidthParams(16));

        // Form container (hidden initially)
        exhFormContainer = new LinearLayout(this);
        exhFormContainer.setOrientation(LinearLayout.VERTICAL);
        exhFormContainer.setVisibility(View.GONE);
        root.addView(exhFormContainer, fullWidthParams(12));

        renderExhibitorList();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void renderExhibitorList() {
        exhListContainer.removeAllViews();
        exhFormContainer.setVisibility(View.GONE);

        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();
        if (exhibitions.isEmpty()) {
            showEmptyState(exhListContainer, getString(R.string.exhibitor_backend_empty));
            return;
        }

        for (final ExhibitorExhibition exh : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            addText(card, exh.getTitle(), R.color.text_primary, 17, Typeface.BOLD);
            addText(card, getString(R.string.exhibitor_day_label, exh.getDay())
                            + " " + exh.getTime() + " · " + exh.getVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);

            int statusColor = exh.isOpenForRegistration()
                    ? R.color.status_open : R.color.status_closed;
            addText(card, exh.getStatus() + " · " + exh.getCategory(),
                    statusColor, 14, Typeface.BOLD);

            // Action buttons
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button editBtn = new Button(this);
            styleSecondaryButton(editBtn);
            editBtn.setText(R.string.exhibitor_edit_exhibition);
            editBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    navigateTo(ExhibitorBackendActivity.class);
                }
            });
            LinearLayout.LayoutParams editP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            editP.setMargins(0, 0, dp(4), 0);
            actions.addView(editBtn, editP);

            Button statusBtn = new Button(this);
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.exhibitor_change_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showExhibitorStatusDialog(exh);
                }
            });
            LinearLayout.LayoutParams statusP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusP.setMargins(dp(4), 0, dp(4), 0);
            actions.addView(statusBtn, statusP);

            Button delBtn = new Button(this);
            styleDangerButton(delBtn);
            delBtn.setText(R.string.exhibitor_delete);
            delBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    confirmDeleteExhibition(exh);
                }
            });
            LinearLayout.LayoutParams delP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            delP.setMargins(dp(4), 0, 0, 0);
            actions.addView(delBtn, delP);

            card.addView(actions, fullWidthParams(8));
            exhListContainer.addView(card, fullWidthParams(10));
        }
        animateListItems(exhListContainer, 100);
    }

    private void showExhibitorStatusDialog(final ExhibitorExhibition exh) {
        final String[] statuses = {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };
        new android.app.AlertDialog.Builder(this)
                .setTitle(R.string.exhibitor_change_status)
                .setItems(statuses, new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        ExhibitionManager.updateStatus(exh.getId(), statuses[which]);
                        Toast.makeText(MainActivity.this,
                                R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();
                        renderExhibitorList();
                    }
                })
                .show();
    }

    private void confirmDeleteExhibition(final ExhibitorExhibition exh) {
        new android.app.AlertDialog.Builder(this)
                .setTitle(R.string.confirm_title)
                .setMessage(R.string.confirm_delete_exhibition)
                .setPositiveButton(R.string.confirm_yes,
                        new android.content.DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(android.content.DialogInterface dialog, int which) {
                                ExhibitionManager.delete(exh.getId());
                                Toast.makeText(MainActivity.this,
                                        R.string.exhibitor_deleted, Toast.LENGTH_SHORT).show();
                                renderExhibitorList();
                            }
                        })
                .setNegativeButton(R.string.confirm_no, null)
                .show();
    }

    // ══════════════════════════════════════════════════════════════
    // Admin content
    // ══════════════════════════════════════════════════════════════

    private ScrollView buildAdminContent() {
        AdminUserManager.ensureInitialized();
        ExhibitionManager.ensureInitialized();

        final LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        addText(root, getString(R.string.admin_backend_title),
                R.color.text_primary, 22, Typeface.BOLD);

        // Sub-tab row
        final LinearLayout tabRow = new LinearLayout(this);
        tabRow.setOrientation(LinearLayout.HORIZONTAL);
        tabRow.setPadding(dp(4), dp(4), dp(4), dp(4));
        GradientDrawable tabBg = new GradientDrawable();
        tabBg.setColor(getResources().getColor(R.color.surface_variant));
        tabBg.setCornerRadius(dp(8));
        tabRow.setBackground(tabBg);
        root.addView(tabRow, fullWidthParams(16));

        final String[] tabLabels = {
                getString(R.string.admin_tab_users),
                getString(R.string.admin_tab_exhibitions),
                getString(R.string.admin_tab_settings)
        };
        final Button[] tabBtns = new Button[3];

        // Summary
        final LinearLayout summaryCard = new LinearLayout(this);
        summaryCard.setOrientation(LinearLayout.VERTICAL);
        summaryCard.setPadding(dp(14), dp(14), dp(14), dp(14));
        styleCard(summaryCard);
        root.addView(summaryCard, fullWidthParams(12));

        // Content section
        final LinearLayout adminContent = new LinearLayout(this);
        adminContent.setOrientation(LinearLayout.VERTICAL);
        root.addView(adminContent, fullWidthParams(16));

        // Detail panel
        final LinearLayout detailPanel = new LinearLayout(this);
        detailPanel.setOrientation(LinearLayout.VERTICAL);
        detailPanel.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(detailPanel);
        detailPanel.setVisibility(View.GONE);
        root.addView(detailPanel, fullWidthParams(12));

        // Build tab buttons
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            Button btn = new Button(this);
            btn.setAllCaps(false);
            btn.setText(tabLabels[i]);
            btn.setTextSize(14);
            btn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    adminCurrentSubTab = idx;
                    renderAdminSubTabs(tabBtns, summaryCard, adminContent, detailPanel);
                }
            });
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            p.setMargins(dp(2), 0, dp(2), 0);
            tabBtns[i] = btn;
            tabRow.addView(btn, p);
        }

        // Store refs for sub-tab rendering via tag
        root.setTag(new Object[]{tabBtns, summaryCard, adminContent, detailPanel});
        renderAdminSubTabs(tabBtns, summaryCard, adminContent, detailPanel);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void renderAdminSubTabs(Button[] tabBtns,
                                    LinearLayout summaryCard,
                                    LinearLayout contentSection,
                                    LinearLayout detailPanel) {
        // Tab button styling
        for (int i = 0; i < tabBtns.length; i++) {
            if (i == adminCurrentSubTab) {
                tabBtns[i].setTextColor(getResources().getColor(R.color.tab_active_text));
                GradientDrawable activeBg = new GradientDrawable();
                activeBg.setColor(getResources().getColor(R.color.tab_active_bg));
                activeBg.setCornerRadius(dp(8));
                tabBtns[i].setBackground(activeBg);
                tabBtns[i].setElevation(dp(2));
            } else {
                tabBtns[i].setTextColor(getResources().getColor(R.color.tab_inactive_text));
                GradientDrawable inactiveBg = new GradientDrawable();
                inactiveBg.setColor(getResources().getColor(R.color.tab_inactive_bg));
                inactiveBg.setCornerRadius(dp(8));
                tabBtns[i].setBackground(inactiveBg);
                tabBtns[i].setElevation(0);
            }
        }

        // Summary
        summaryCard.removeAllViews();
        List<AdminUser> users = AdminUserManager.listAll();
        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();
        addText(summaryCard, getString(R.string.admin_summary_users, users.size()),
                R.color.text_primary, 15, Typeface.BOLD);
        addText(summaryCard, getString(R.string.admin_summary_exhibitions, exhibitions.size()),
                R.color.text_primary, 15, Typeface.NORMAL);
        addText(summaryCard, getString(R.string.admin_summary_active,
                        AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE),
                        AdminUserManager.countByStatus(AdminUser.STATUS_BANNED),
                        AdminUserManager.countByStatus(AdminUser.STATUS_RESTRICTED)),
                R.color.text_secondary, 14, Typeface.NORMAL);

        // Content
        contentSection.removeAllViews();
        animateHidePanel(detailPanel);

        if (adminCurrentSubTab == ADMIN_TAB_USERS) {
            renderAdminUsers(contentSection, detailPanel);
        } else if (adminCurrentSubTab == ADMIN_TAB_EXHIBITIONS) {
            renderAdminExhibitions(contentSection, detailPanel);
        } else {
            renderAdminSettings(contentSection);
        }
    }

    private void renderAdminUsers(LinearLayout container, final LinearLayout detailPanel) {
        List<AdminUser> users = AdminUserManager.listAll();
        addText(container, getString(R.string.admin_tab_users),
                R.color.text_primary, 20, Typeface.BOLD);

        if (users.isEmpty()) {
            showEmptyState(container, getString(R.string.empty_users_generic));
            return;
        }

        for (final AdminUser user : users) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            addText(card, user.getNickname(), R.color.text_primary, 17, Typeface.BOLD);
            addText(card, user.getEmail(), R.color.text_secondary, 14, Typeface.NORMAL);
            int sc = user.isActive() ? R.color.status_open
                    : (user.isBanned() ? R.color.status_closed : R.color.status_pending);
            addText(card, getString(R.string.admin_user_status_label, user.getStatus()),
                    sc, 14, Typeface.BOLD);
            addText(card, getString(R.string.admin_user_registered, user.getRegistrationTime()),
                    R.color.text_secondary, 13, Typeface.NORMAL);
            addText(card, getString(R.string.admin_user_last_login, user.getLastLoginTime()),
                    R.color.text_secondary, 13, Typeface.NORMAL);

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button detailBtn = new Button(this);
            styleSecondaryButton(detailBtn);
            detailBtn.setText(R.string.admin_user_detail_title);
            detailBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAdminUserDetail(user, detailPanel);
                }
            });
            LinearLayout.LayoutParams dP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            dP.setMargins(0, 0, dp(4), 0);
            actions.addView(detailBtn, dP);

            Button statusBtn = new Button(this);
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.admin_change_user_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAdminUserStatusDialog(user);
                }
            });
            LinearLayout.LayoutParams sP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            sP.setMargins(dp(4), 0, 0, 0);
            actions.addView(statusBtn, sP);

            card.addView(actions, fullWidthParams(8));
            container.addView(card, fullWidthParams(10));
        }
        animateListItems(container, 100);
    }

    private void showAdminUserDetail(AdminUser user, LinearLayout detailPanel) {
        animateShowPanel(detailPanel);
        detailPanel.removeAllViews();

        addText(detailPanel, getString(R.string.admin_user_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(detailPanel, getString(R.string.admin_user_label_nickname) + "：" + user.getNickname(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(detailPanel, getString(R.string.admin_user_label_email) + "：" + user.getEmail(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        int sc = user.isActive() ? R.color.status_open
                : (user.isBanned() ? R.color.status_closed : R.color.status_pending);
        addText(detailPanel, getString(R.string.admin_user_label_status) + "：" + user.getStatus(),
                sc, 15, Typeface.BOLD);
        addText(detailPanel, getString(R.string.admin_user_label_reg_time) + "：" + user.getRegistrationTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailPanel, getString(R.string.admin_user_label_last_login) + "：" + user.getLastLoginTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        Button closeBtn = new Button(this);
        styleSecondaryButton(closeBtn);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                animateHidePanel(detailPanel);
            }
        });
        detailPanel.addView(closeBtn, fullWidthParams(8));
    }

    private void showAdminUserStatusDialog(final AdminUser user) {
        final String[] statuses = {
                AdminUser.STATUS_ACTIVE,
                AdminUser.STATUS_BANNED,
                AdminUser.STATUS_RESTRICTED
        };
        new android.app.AlertDialog.Builder(this)
                .setTitle(R.string.admin_change_user_status)
                .setItems(statuses, new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        AdminUserManager.updateStatus(user.getId(), statuses[which]);
                        Toast.makeText(MainActivity.this,
                                R.string.admin_user_status_changed, Toast.LENGTH_SHORT).show();
                        invalidateTab(TAB_ADMIN);
                        showTab(TAB_ADMIN, false);
                    }
                })
                .show();
    }

    private void renderAdminExhibitions(LinearLayout container, final LinearLayout detailPanel) {
        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();
        addText(container, getString(R.string.admin_tab_exhibitions),
                R.color.text_primary, 20, Typeface.BOLD);

        if (exhibitions.isEmpty()) {
            showEmptyState(container, getString(R.string.empty_exhibitions_generic));
            return;
        }

        for (final ExhibitorExhibition exh : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            addText(card, exh.getTitle(), R.color.text_primary, 17, Typeface.BOLD);
            addText(card, getString(R.string.admin_exhibition_day_label, exh.getDay())
                            + " " + exh.getTime() + " · " + exh.getVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);
            int sc = exh.isOpenForRegistration() ? R.color.status_open : R.color.status_closed;
            addText(card, exh.getStatus() + " · " + exh.getCategory(),
                    sc, 14, Typeface.BOLD);

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button detailBtn = new Button(this);
            styleSecondaryButton(detailBtn);
            detailBtn.setText(R.string.admin_exhibition_detail_title);
            detailBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAdminExhibitionDetail(exh, detailPanel);
                }
            });
            LinearLayout.LayoutParams dP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            dP.setMargins(0, 0, dp(4), 0);
            actions.addView(detailBtn, dP);

            Button statusBtn = new Button(this);
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.admin_change_exhibition_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAdminExhibitionStatusDialog(exh);
                }
            });
            LinearLayout.LayoutParams sP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            sP.setMargins(dp(4), 0, dp(4), 0);
            actions.addView(statusBtn, sP);

            Button lockBtn = new Button(this);
            styleSecondaryButton(lockBtn);
            lockBtn.setText(exh.isOpenForRegistration()
                    ? R.string.admin_lock_exhibition
                    : R.string.admin_unlock_exhibition);
            lockBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    toggleAdminExhibitionLock(exh);
                }
            });
            LinearLayout.LayoutParams lP = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lP.setMargins(dp(4), 0, 0, 0);
            actions.addView(lockBtn, lP);

            card.addView(actions, fullWidthParams(8));
            container.addView(card, fullWidthParams(10));
        }
        animateListItems(container, 100);
    }

    private void showAdminExhibitionDetail(ExhibitorExhibition exh, LinearLayout detailPanel) {
        animateShowPanel(detailPanel);
        detailPanel.removeAllViews();

        addText(detailPanel, getString(R.string.admin_exhibition_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(detailPanel, getString(R.string.admin_exhibition_label_title) + "：" + exh.getTitle(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(detailPanel, getString(R.string.admin_exhibition_label_venue) + "：" + exh.getVenue(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailPanel, getString(R.string.admin_exhibition_label_date) + "：6月" + exh.getDay() + "日",
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailPanel, getString(R.string.admin_exhibition_label_time) + "：" + exh.getTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        int sc = exh.isOpenForRegistration() ? R.color.status_open : R.color.status_closed;
        addText(detailPanel, getString(R.string.admin_exhibition_label_status) + "：" + exh.getStatus(),
                sc, 15, Typeface.BOLD);

        Button closeBtn = new Button(this);
        styleSecondaryButton(closeBtn);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                animateHidePanel(detailPanel);
            }
        });
        detailPanel.addView(closeBtn, fullWidthParams(8));
    }

    private void showAdminExhibitionStatusDialog(final ExhibitorExhibition exh) {
        final String[] statuses = {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };
        new android.app.AlertDialog.Builder(this)
                .setTitle(R.string.admin_change_exhibition_status)
                .setItems(statuses, new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        ExhibitionManager.updateStatus(exh.getId(), statuses[which]);
                        Toast.makeText(MainActivity.this,
                                R.string.admin_exhibition_status_changed, Toast.LENGTH_SHORT).show();
                        invalidateTab(TAB_ADMIN);
                        showTab(TAB_ADMIN, false);
                    }
                })
                .show();
    }

    private void toggleAdminExhibitionLock(ExhibitorExhibition exh) {
        if (exh.isOpenForRegistration()) {
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_CLOSED);
            Toast.makeText(this, R.string.admin_exhibition_locked, Toast.LENGTH_SHORT).show();
        } else {
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_OPEN);
            Toast.makeText(this, R.string.admin_exhibition_unlocked, Toast.LENGTH_SHORT).show();
        }
        invalidateTab(TAB_ADMIN);
        showTab(TAB_ADMIN, false);
    }

    private void renderAdminSettings(LinearLayout container) {
        addText(container, getString(R.string.admin_settings_title),
                R.color.text_primary, 20, Typeface.BOLD);

        addText(container, getString(R.string.admin_settings_media_limit),
                R.color.text_primary, 17, Typeface.BOLD);

        addText(container, getString(R.string.admin_settings_image_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        android.widget.EditText imageLimit = new android.widget.EditText(this);
        imageLimit.setSingleLine(true);
        imageLimit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        imageLimit.setText("10");
        container.addView(imageLimit, fullWidthParams(4));

        addText(container, getString(R.string.admin_settings_video_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        android.widget.EditText videoLimit = new android.widget.EditText(this);
        videoLimit.setSingleLine(true);
        videoLimit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        videoLimit.setText("100");
        container.addView(videoLimit, fullWidthParams(4));

        addText(container, getString(R.string.admin_settings_gallery_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        android.widget.EditText galleryLimit = new android.widget.EditText(this);
        galleryLimit.setSingleLine(true);
        galleryLimit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        galleryLimit.setText("50");
        container.addView(galleryLimit, fullWidthParams(4));

        addText(container, getString(R.string.admin_settings_hint),
                R.color.text_secondary, 13, Typeface.NORMAL);

        Button saveBtn = new Button(this);
        stylePrimaryButton(saveBtn);
        saveBtn.setText(R.string.admin_settings_save);
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Toast.makeText(MainActivity.this,
                        R.string.admin_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        container.addView(saveBtn, fullWidthParams(14));

        animateListItems(container, 80);
    }

    // ══════════════════════════════════════════════════════════════
    // Data helpers
    // ══════════════════════════════════════════════════════════════

    private List<Exhibition> getExhibitionsForDay(int day) {
        List<Exhibition> result = new ArrayList<>();
        for (Exhibition e : SAMPLE_EXHIBITIONS) {
            if (e.day == day) {
                result.add(e);
            }
        }
        return result;
    }

    private int countExhibitionsForDay(int day) {
        int count = 0;
        for (Exhibition e : SAMPLE_EXHIBITIONS) {
            if (e.day == day) {
                count++;
            }
        }
        return count;
    }

    /** Immutable exhibition model for sample data. */
    private static class Exhibition {
        final int day;
        final String title;
        final String venue;
        final String time;
        final String status;
        final boolean openForRegistration;
        final String description;
        final String category;

        Exhibition(int day, String title, String venue, String time, String status,
                   boolean openForRegistration, String description, String category) {
            this.day = day;
            this.title = title;
            this.venue = venue;
            this.time = time;
            this.status = status;
            this.openForRegistration = openForRegistration;
            this.description = description;
            this.category = category;
        }
    }
}
