package com.example.calmobile;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * More / Account screen providing quick access to search,
 * notification settings, data export, and logout.
 */
public class MoreActivity extends BaseActivity {

    private LinearLayout menuSection;
    private LinearLayout notificationSection;
    private LinearLayout logoutSection;
    private ScrollView scrollView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_more);

        menuSection = findViewById(R.id.more_menu);
        notificationSection = findViewById(R.id.more_notification_section);
        logoutSection = findViewById(R.id.more_logout);
        scrollView = findViewById(R.id.more_scroll);

        TextView backBtn = findViewById(R.id.more_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        renderMenuItems();
        renderNotificationSection();
        renderLogoutSection();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Menu items ────────────────────────────────────────────────────

    private void renderMenuItems() {
        menuSection.removeAllViews();
        styleCard(menuSection);

        addMenuItem(menuSection, getString(R.string.nav_more_search),
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        navigateTo(SearchActivity.class);
                    }
                });

        addDivider(menuSection);

        addMenuItem(menuSection, getString(R.string.nav_more_notifications),
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        // Scroll to in-place notification section below
                        scrollToNotificationSection();
                    }
                });

        addDivider(menuSection);

        addMenuItem(menuSection, getString(R.string.nav_more_export),
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        Toast.makeText(MoreActivity.this,
                                R.string.export_empty, Toast.LENGTH_SHORT).show();
                    }
                });

        animateShowPanel(menuSection);
    }

    private void scrollToNotificationSection() {
        if (scrollView == null || notificationSection == null) {
            return;
        }

        scrollView.post(new Runnable() {
            @Override
            public void run() {
                scrollView.smoothScrollTo(0, notificationSection.getTop());
                notificationSection.requestFocus();
            }
        });
    }

    // ── Notification settings ────────────────────────────────────────

    private void renderNotificationSection() {
        notificationSection.removeAllViews();
        styleCard(notificationSection);

        final NotificationHelper helper = NotificationHelper.getInstance(this);

        // Section title
        addText(notificationSection, getString(R.string.notification_settings_title),
                R.color.text_primary, 17, Typeface.BOLD);

        // Exhibition reminder toggle
        final CheckBox exhibitionToggle = new CheckBox(this);
        exhibitionToggle.setText(getString(R.string.notification_exhibition_reminder)
                + "\n" + getString(R.string.notification_exhibition_reminder_desc));
        exhibitionToggle.setTextSize(14);
        exhibitionToggle.setChecked(helper.isExhibitionReminderEnabled());
        exhibitionToggle.setPadding(dp(4), dp(8), dp(4), dp(8));
        exhibitionToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                helper.setExhibitionReminderEnabled(exhibitionToggle.isChecked());
                Toast.makeText(MoreActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notificationSection.addView(exhibitionToggle, fullWidthParams(4));

        // Registration updates toggle
        final CheckBox registrationToggle = new CheckBox(this);
        registrationToggle.setText(getString(R.string.notification_registration_updates)
                + "\n" + getString(R.string.notification_registration_updates_desc));
        registrationToggle.setTextSize(14);
        registrationToggle.setChecked(helper.isRegistrationUpdatesEnabled());
        registrationToggle.setPadding(dp(4), dp(8), dp(4), dp(8));
        registrationToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                helper.setRegistrationUpdatesEnabled(registrationToggle.isChecked());
                Toast.makeText(MoreActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notificationSection.addView(registrationToggle, fullWidthParams(4));

        addDivider(notificationSection);

        // Notification history
        addText(notificationSection, getString(R.string.notification_history_title),
                R.color.text_primary, 15, Typeface.BOLD);

        List<NotificationHelper.NotificationRecord> history = helper.getHistory();
        if (history.isEmpty()) {
            addText(notificationSection, getString(R.string.notification_history_empty),
                    R.color.text_tertiary, 14, Typeface.NORMAL);
        } else {
            addText(notificationSection,
                    getString(R.string.notification_history_count, history.size()),
                    R.color.text_secondary, 13, Typeface.NORMAL);

            int limit = Math.min(history.size(), 5);
            SimpleDateFormat sdf = new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault());
            for (int i = 0; i < limit; i++) {
                NotificationHelper.NotificationRecord record = history.get(i);
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(10), dp(8), dp(10), dp(8));

                GradientDrawable rowBg = new GradientDrawable();
                rowBg.setColor(getResources().getColor(R.color.surface_variant));
                rowBg.setCornerRadius(dp(8));
                row.setBackground(rowBg);

                addText(row, record.type + " - " + record.relatedTitle,
                        R.color.text_primary, 13, Typeface.BOLD);
                addText(row, record.message,
                        R.color.text_secondary, 12, Typeface.NORMAL);
                addText(row, sdf.format(new Date(record.timestamp)),
                        R.color.text_tertiary, 11, Typeface.NORMAL);

                notificationSection.addView(row, fullWidthParams(4));
            }
        }

        // Clear history button
        if (!history.isEmpty()) {
            TextView clearBtn = new TextView(this);
            clearBtn.setText(getString(R.string.notification_clear_history));
            clearBtn.setTextColor(getResources().getColor(R.color.status_closed));
            clearBtn.setTextSize(14);
            clearBtn.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            clearBtn.setPadding(dp(4), dp(12), dp(4), dp(4));
            clearBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    helper.clearHistory();
                    renderNotificationSection();
                    Toast.makeText(MoreActivity.this,
                            R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
                }
            });
            notificationSection.addView(clearBtn, fullWidthParams(4));
        }

        animateShowPanel(notificationSection);
    }

    // ── Logout section ────────────────────────────────────────────────

    private void renderLogoutSection() {
        logoutSection.removeAllViews();
        styleCard(logoutSection);

        TextView logoutText = new TextView(this);
        logoutText.setText(getString(R.string.nav_more_logout));
        logoutText.setTextColor(getResources().getColor(R.color.status_closed));
        logoutText.setTextSize(16);
        logoutText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        logoutText.setGravity(android.view.Gravity.CENTER);
        logoutText.setPadding(dp(16), dp(14), dp(16), dp(14));

        logoutText.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showConfirmDialog(
                        getString(R.string.nav_more_logout_confirm),
                        new Runnable() {
                            @Override
                            public void run() {
                                performLogout();
                            }
                        });
            }
        });

        logoutSection.addView(logoutText, fullWidthParams(0));

        logoutSection.setAlpha(0f);
        logoutSection.setTranslationY(dp(16));
        logoutSection.animate()
                .alpha(1f).translationY(0)
                .setDuration(300).setStartDelay(100)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    // ── Logout action ─────────────────────────────────────────────────

    private void performLogout() {
        AuthManager.getInstance().logout();
        Intent intent = new Intent(this, LoginActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
        finish();
    }

    // ── Helper: clickable menu row ────────────────────────────────────

    private void addMenuItem(LinearLayout parent, String label, View.OnClickListener listener) {
        TextView row = new TextView(this);
        row.setText(label);
        row.setTextColor(getResources().getColor(R.color.text_primary));
        row.setTextSize(16);
        row.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        row.setPadding(dp(4), dp(14), dp(4), dp(14));
        row.setClickable(true);
        row.setFocusable(true);
        row.setOnClickListener(listener);
        parent.addView(row, fullWidthParams(0));
    }
}
