package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Main activity displaying the exhibition calendar, exhibition list,
 * and user registrations. Exhibition detail and registration form
 * are now separate Activity pages.
 */
public class MainActivity extends BaseActivity {
    private static final int MONTH_DAYS = 30;

    private static final Exhibition[] SAMPLE_EXHIBITIONS = new Exhibition[] {
            new Exhibition(
                    6,
                    "华南智能制造展",
                    "深圳国际会展中心 6 号馆",
                    "09:30-17:00",
                    "报名中",
                    true,
                    "聚焦工业机器人、柔性产线和数字化工厂方案，适合制造业采购与技术负责人参观。",
                    "智能制造 / 工业自动化"),
            new Exhibition(
                    12,
                    "绿色能源装备展",
                    "广州琶洲展馆 A 区",
                    "10:00-18:00",
                    "报名中",
                    true,
                    "展示储能、电池回收、光伏逆变器和低碳园区方案，现场开放采购对接区。",
                    "新能源 / 储能"),
            new Exhibition(
                    12,
                    "跨境电商选品会",
                    "广州琶洲展馆 B 区",
                    "13:30-20:00",
                    "席位紧张",
                    true,
                    "本地假数据演示：用当天多场展会验证列表、详情和报名表单切换流程。",
                    "电商 / 选品"),
            new Exhibition(
                    21,
                    "城市更新材料展",
                    "上海新国际博览中心",
                    "09:00-16:30",
                    "报名截止",
                    false,
                    "面向建筑材料、节能门窗和旧改服务商的专业展，当前样例设置为不可报名状态。",
                    "建筑材料 / 城市更新")
    };

    private TextView statusText;
    private GridLayout calendarGrid;
    private LinearLayout exhibitionList;

    private final RegistrationManager registrationManager = new RegistrationManager();
    private LinearLayout myRegistrationsList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.status_text);
        calendarGrid = findViewById(R.id.calendar_grid);
        exhibitionList = findViewById(R.id.exhibition_list);
        myRegistrationsList = findViewById(R.id.my_registrations_list);

        statusText.setText(R.string.home_status);
        buildMonthGrid();
        showExhibitionsForDay(12);
        renderMyRegistrations();

        // Search bar — navigate to SearchActivity
        View searchBar = findViewById(R.id.home_search_bar);
        if (searchBar != null) {
            searchBar.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    navigateTo(SearchActivity.class);
                }
            });
        }

        // Request notification permission on API 33+
        NotificationHelper.getInstance(this).requestNotificationPermission(this);

        setupBottomNav();
    }

    /**
     * Wire the bottom navigation bar tabs.
     * Home tab is active (current screen); other tabs navigate to their targets.
     */
    private void setupBottomNav() {
        // Mark home tab as active
        View homeTab = findViewById(R.id.nav_home);
        if (homeTab != null) {
            homeTab.setSelected(true);
            homeTab.setOnClickListener(null);
        }
        TextView homeText = findViewById(R.id.nav_home_text);
        if (homeText != null) {
            homeText.setTextColor(getResources().getColor(R.color.nav_active_text));
        }
        android.widget.ImageView homeIcon = findViewById(R.id.nav_home_icon);
        if (homeIcon != null) {
            homeIcon.setColorFilter(getResources().getColor(R.color.nav_active_icon));
        }

        // Home — already on MainActivity, no-op

        // Profile
        findViewById(R.id.nav_profile).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                navigateTo(ProfileActivity.class);
            }
        });

        // Exhibitor
        findViewById(R.id.nav_exhibitor).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                navigateTo(ExhibitorBackendActivity.class);
            }
        });

        // Admin
        findViewById(R.id.nav_admin).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                navigateTo(AdminBackendActivity.class);
            }
        });

        // More — opens MoreActivity
        findViewById(R.id.nav_more).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                navigateTo(MoreActivity.class);
            }
        });
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Card styling with ripple ───────────────────────────────────────

    /**
     * Apply a ripple background effect to a view, used for clickable cards.
     *
     * @param view the View to apply the ripple background to
     */
    private void applyRippleBackground(final View view) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(getResources().getColor(R.color.card_background));
        shape.setCornerRadius(dp(12));
        shape.setStroke(dp(1), getResources().getColor(R.color.card_stroke));

        RippleDrawable ripple = new RippleDrawable(
                android.content.res.ColorStateList.valueOf(getResources().getColor(R.color.ripple_color)),
                shape, null);
        view.setBackground(ripple);
    }

    // ── Calendar grid ─────────────────────────────────────────────────

    private void buildMonthGrid() {
        calendarGrid.removeAllViews();

        for (int day = 1; day <= MONTH_DAYS; day++) {
            final int selectedDay = day;
            int count = countExhibitionsForDay(day);
            Button dayButton = new Button(this);
            dayButton.setAllCaps(false);
            dayButton.setText(count > 0 ? day + "\n" + count + "场" : String.valueOf(day));
            dayButton.setTextColor(getResources().getColor(count > 0 ? R.color.date_active_text : R.color.text_secondary));
            dayButton.setTextSize(12);
            dayButton.setTypeface(android.graphics.Typeface.DEFAULT, count > 0 ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);

            // Use rounded drawable backgrounds for calendar cells
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
            dayButton.setPadding(0, dp(8), 0, dp(8));
            dayButton.setGravity(android.view.Gravity.CENTER);
            dayButton.setIncludeFontPadding(false);
            dayButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showExhibitionsForDay(selectedDay);
                }
            });

            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(56);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(2), dp(2), dp(2), dp(2));
            calendarGrid.addView(dayButton, params);
        }
    }

    // ── Exhibition list for a day ─────────────────────────────────────

    private void showExhibitionsForDay(int day) {
        exhibitionList.removeAllViews();
        List<Exhibition> exhibitions = getExhibitionsForDay(day);
        statusText.setText(getString(R.string.local_day_count, day, exhibitions.size()));

        if (exhibitions.isEmpty()) {
            showEmptyState(exhibitionList, getString(R.string.empty_exhibitions_day));
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
                public void onClick(View view) {
                    openExhibitionDetail(exhibition);
                }
            });

            addText(card, exhibition.title, R.color.text_primary, 18, Typeface.BOLD);
            addText(card, exhibition.time + " · " + exhibition.venue, R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, exhibition.status + " · " + exhibition.category, exhibition.openForRegistration ? R.color.status_open : R.color.status_closed, 14, Typeface.BOLD);

            Button detailButton = new Button(this);
            detailButton.setAllCaps(false);
            detailButton.setText(R.string.exhibition_detail);
            detailButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    openExhibitionDetail(exhibition);
                }
            });
            card.addView(detailButton, fullWidthParams(8));

            exhibitionList.addView(card, fullWidthParams(10));
        }

        animateListItems(exhibitionList, 100);
    }

    // ── Navigate to exhibition detail ─────────────────────────────────

    /**
     * Open the exhibition detail page as a separate Activity.
     *
     * @param exhibition the exhibition to display
     */
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

    // ── My registrations list ─────────────────────────────────────────

    private void renderMyRegistrations() {
        myRegistrationsList.removeAllViews();
        List<Registration> registrations = registrationManager.list();

        if (registrations.isEmpty()) {
            showEmptyState(myRegistrationsList, getString(R.string.my_registrations_empty));
            return;
        }

        for (final Registration registration : registrations) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            addText(card, registration.getExhibitionTitle(),
                    R.color.text_primary, 16, Typeface.BOLD);
            addText(card, "6月" + registration.getExhibitionDay() + "日 "
                            + registration.getExhibitionTime() + " · "
                            + registration.getExhibitionVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, registration.getVisitorName() + " · "
                            + registration.getVisitorType(),
                    R.color.text_primary, 14, Typeface.NORMAL);

            // Make visitor name clickable — opens public profile
            TextView visitorLine = addText(card, getString(R.string.user_public_view_profile_hint),
                    R.color.status_open, 13, Typeface.NORMAL);
            visitorLine.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openUserPublicProfile(registration);
                }
            });
            String statusLabel = registration.getStatus() == Registration.Status.PENDING
                    ? getString(R.string.status_pending) : getString(R.string.status_cancelled);
            addText(card, statusLabel + " · " + registration.getNeedsSummary(),
                    registration.getStatus() == Registration.Status.PENDING
                            ? R.color.status_open : R.color.status_closed,
                    14, Typeface.BOLD);

            final boolean isCancelled = registration.getStatus() == Registration.Status.CANCELLED;
            if (!isCancelled) {
                Button cancelButton = new Button(this);
                cancelButton.setAllCaps(false);
                cancelButton.setText(R.string.cancel_registration);
                cancelButton.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) {
                        showConfirmDialog(
                                getString(R.string.confirm_cancel_registration),
                                new Runnable() {
                                    @Override
                                    public void run() {
                                        registrationManager.cancel(registration.getId());
                                        Toast.makeText(MainActivity.this,
                                                R.string.registration_cancelled, Toast.LENGTH_SHORT).show();
                                        renderMyRegistrations();
                                    }
                                });
                    }
                });
                card.addView(cancelButton, fullWidthParams(6));
            } else {
                addText(card, getString(R.string.status_cancelled),
                        R.color.status_closed, 14, Typeface.BOLD);
            }

            myRegistrationsList.addView(card, fullWidthParams(8));
        }

        animateListItems(myRegistrationsList, 50);
    }

    // ── Open user public profile ──────────────────────────────────────

    private void openUserPublicProfile(Registration registration) {
        List<Registration> allRegs = registrationManager.list();
        List<Registration> visitorRegs = new ArrayList<>();
        for (Registration r : allRegs) {
            if (r.getVisitorName().equals(registration.getVisitorName())) {
                visitorRegs.add(r);
            }
        }

        int count = visitorRegs.size();
        String[] titles = new String[count];
        String[] days = new String[count];
        String[] times = new String[count];
        String[] venues = new String[count];
        String[] statuses = new String[count];
        String[] needs = new String[count];

        for (int i = 0; i < count; i++) {
            Registration r = visitorRegs.get(i);
            titles[i] = r.getExhibitionTitle();
            days[i] = "6月" + r.getExhibitionDay() + "日";
            times[i] = r.getExhibitionTime();
            venues[i] = r.getExhibitionVenue();
            statuses[i] = r.getStatus() == Registration.Status.PENDING
                    ? getString(R.string.status_pending) : getString(R.string.status_cancelled);
            needs[i] = r.getNeedsSummary();
        }

        Intent intent = new Intent(this, UserPublicActivity.class);
        intent.putExtra("nickname", registration.getVisitorName());
        intent.putExtra("bio", "");
        intent.putExtra("contact", "");
        intent.putExtra("socialMedia", "");
        intent.putExtra("showRegistrations", true);
        intent.putExtra("isOwnProfile", true);
        intent.putExtra("regExhibitionTitles", titles);
        intent.putExtra("regExhibitionDays", days);
        intent.putExtra("regExhibitionTimes", times);
        intent.putExtra("regExhibitionVenues", venues);
        intent.putExtra("regStatuses", statuses);
        intent.putExtra("regNeedsSummaries", needs);
        navigateTo(intent);
    }

    // ── Data helpers ──────────────────────────────────────────────────

    private List<Exhibition> getExhibitionsForDay(int day) {
        List<Exhibition> exhibitions = new ArrayList<>();
        for (Exhibition exhibition : SAMPLE_EXHIBITIONS) {
            if (exhibition.day == day) {
                exhibitions.add(exhibition);
            }
        }
        return exhibitions;
    }

    private int countExhibitionsForDay(int day) {
        int count = 0;
        for (Exhibition exhibition : SAMPLE_EXHIBITIONS) {
            if (exhibition.day == day) {
                count++;
            }
        }
        return count;
    }

    /** Immutable exhibition model for the main activity's sample data. */
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
