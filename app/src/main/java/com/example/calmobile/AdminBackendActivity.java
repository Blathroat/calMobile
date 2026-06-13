package com.example.calmobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * Admin backend activity.
 * Allows administrators to manage users, exhibitions, and system settings.
 * All data is in-memory only (current session).
 */
public class AdminBackendActivity extends Activity {

    private static final int TAB_USERS = 0;
    private static final int TAB_EXHIBITIONS = 1;
    private static final int TAB_SETTINGS = 2;

    private LinearLayout tabRow;
    private LinearLayout summarySection;
    private LinearLayout usersSection;
    private LinearLayout userDetailPanel;
    private LinearLayout exhibitionsSection;
    private LinearLayout exhibitionDetailPanel;
    private LinearLayout settingsSection;

    private int currentTab = TAB_USERS;
    private Button[] tabButtons;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_admin_backend);

        tabRow = findViewById(R.id.admin_tab_row);
        summarySection = findViewById(R.id.admin_summary);
        usersSection = findViewById(R.id.admin_users_section);
        userDetailPanel = findViewById(R.id.admin_user_detail);
        exhibitionsSection = findViewById(R.id.admin_exhibitions_section);
        exhibitionDetailPanel = findViewById(R.id.admin_exhibition_detail);
        settingsSection = findViewById(R.id.admin_settings_section);

        // Ensure sample data is seeded
        AdminUserManager.ensureInitialized();
        ExhibitionManager.ensureInitialized();

        // Back button
        TextView backBtn = findViewById(R.id.admin_back);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        buildTabRow();
        switchTab(TAB_USERS);
    }

    // ── Tab switcher ────────────────────────────────────────────────

    private void buildTabRow() {
        tabRow.removeAllViews();
        String[] labels = new String[] {
                getString(R.string.admin_tab_users),
                getString(R.string.admin_tab_exhibitions),
                getString(R.string.admin_tab_settings)
        };
        tabButtons = new Button[3];

        for (int i = 0; i < 3; i++) {
            final int tabIndex = i;
            Button tabBtn = new Button(this);
            tabBtn.setAllCaps(false);
            tabBtn.setText(labels[i]);
            tabBtn.setTextSize(14);
            tabBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    switchTab(tabIndex);
                }
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            params.setMargins(dp(2), 0, dp(2), 0);
            tabButtons[i] = tabBtn;
            tabRow.addView(tabBtn, params);
        }
    }

    private void switchTab(int tabIndex) {
        currentTab = tabIndex;

        // Update tab button appearance
        for (int i = 0; i < tabButtons.length; i++) {
            if (i == tabIndex) {
                tabButtons[i].setTextColor(getResources().getColor(R.color.card_background));
                tabButtons[i].setBackgroundColor(getResources().getColor(R.color.status_open));
            } else {
                tabButtons[i].setTextColor(getResources().getColor(R.color.text_primary));
                tabButtons[i].setBackgroundColor(getResources().getColor(R.color.card_background));
            }
        }

        // Show/hide sections
        usersSection.setVisibility(tabIndex == TAB_USERS ? View.VISIBLE : View.GONE);
        userDetailPanel.setVisibility(View.GONE);
        exhibitionsSection.setVisibility(tabIndex == TAB_EXHIBITIONS ? View.VISIBLE : View.GONE);
        exhibitionDetailPanel.setVisibility(View.GONE);
        settingsSection.setVisibility(tabIndex == TAB_SETTINGS ? View.VISIBLE : View.GONE);

        // Render current tab content
        renderSummary();
        if (tabIndex == TAB_USERS) {
            renderUserList();
        } else if (tabIndex == TAB_EXHIBITIONS) {
            renderExhibitionList();
        } else if (tabIndex == TAB_SETTINGS) {
            renderSettings();
        }
    }

    // ── Summary bar ─────────────────────────────────────────────────

    private void renderSummary() {
        summarySection.removeAllViews();

        List<AdminUser> users = AdminUserManager.listAll();
        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();

        addText(summarySection, getString(R.string.admin_summary_users, users.size()),
                R.color.text_primary, 15, Typeface.BOLD);
        addText(summarySection, getString(R.string.admin_summary_exhibitions, exhibitions.size()),
                R.color.text_primary, 15, Typeface.NORMAL);
        addText(summarySection, getString(R.string.admin_summary_active,
                        AdminUserManager.countByStatus(AdminUser.STATUS_ACTIVE),
                        AdminUserManager.countByStatus(AdminUser.STATUS_BANNED),
                        AdminUserManager.countByStatus(AdminUser.STATUS_RESTRICTED)),
                R.color.text_secondary, 14, Typeface.NORMAL);
    }

    // ── Users tab ───────────────────────────────────────────────────

    private void renderUserList() {
        usersSection.removeAllViews();
        userDetailPanel.setVisibility(View.GONE);

        List<AdminUser> users = AdminUserManager.listAll();

        addText(usersSection, getString(R.string.admin_tab_users),
                R.color.text_primary, 20, Typeface.BOLD);

        if (users.isEmpty()) {
            addText(usersSection, "暂无用户数据。",
                    R.color.text_secondary, 15, Typeface.NORMAL);
            return;
        }

        for (final AdminUser user : users) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            card.setBackgroundResource(R.color.card_background);

            // Nickname
            addText(card, user.getNickname(), R.color.text_primary, 17, Typeface.BOLD);

            // Email
            addText(card, user.getEmail(), R.color.text_secondary, 14, Typeface.NORMAL);

            // Status line
            int statusColor = user.isActive()
                    ? R.color.status_open
                    : (user.isBanned() ? R.color.status_closed : R.color.status_pending);
            addText(card, getString(R.string.admin_user_status_label, user.getStatus()),
                    statusColor, 14, Typeface.BOLD);

            // Times
            addText(card, getString(R.string.admin_user_registered, user.getRegistrationTime()),
                    R.color.text_secondary, 13, Typeface.NORMAL);
            addText(card, getString(R.string.admin_user_last_login, user.getLastLoginTime()),
                    R.color.text_secondary, 13, Typeface.NORMAL);

            // Action buttons row
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            // View detail button
            Button detailBtn = new Button(this);
            detailBtn.setAllCaps(false);
            detailBtn.setText(R.string.admin_user_detail_title);
            detailBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showUserDetail(user);
                }
            });
            LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            detailParams.setMargins(0, 0, dp(4), 0);
            actions.addView(detailBtn, detailParams);

            // Change status button
            Button statusBtn = new Button(this);
            statusBtn.setAllCaps(false);
            statusBtn.setText(R.string.admin_change_user_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showUserStatusDialog(user);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, 0, 0);
            actions.addView(statusBtn, statusParams);

            card.addView(actions, fullWidthParams(8));

            usersSection.addView(card, fullWidthParams(10));
        }
    }

    private void showUserDetail(final AdminUser user) {
        userDetailPanel.setVisibility(View.VISIBLE);
        userDetailPanel.removeAllViews();

        addText(userDetailPanel, getString(R.string.admin_user_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);

        addText(userDetailPanel, getString(R.string.admin_user_label_nickname) + "：" + user.getNickname(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(userDetailPanel, getString(R.string.admin_user_label_email) + "：" + user.getEmail(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        int statusColor = user.isActive()
                ? R.color.status_open
                : (user.isBanned() ? R.color.status_closed : R.color.status_pending);
        addText(userDetailPanel, getString(R.string.admin_user_label_status) + "：" + user.getStatus(),
                statusColor, 15, Typeface.BOLD);

        addText(userDetailPanel, getString(R.string.admin_user_label_reg_time) + "：" + user.getRegistrationTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(userDetailPanel, getString(R.string.admin_user_label_last_login) + "：" + user.getLastLoginTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        // Action buttons
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);

        Button statusBtn = new Button(this);
        statusBtn.setAllCaps(false);
        statusBtn.setText(R.string.admin_change_user_status);
        statusBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showUserStatusDialog(user);
            }
        });
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(0, dp(8), dp(4), 0);
        actions.addView(statusBtn, statusParams);

        Button closeBtn = new Button(this);
        closeBtn.setAllCaps(false);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                userDetailPanel.setVisibility(View.GONE);
            }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        closeParams.setMargins(dp(4), dp(8), 0, 0);
        actions.addView(closeBtn, closeParams);

        userDetailPanel.addView(actions, fullWidthParams(0));
    }

    private void showUserStatusDialog(final AdminUser user) {
        final String[] statuses = new String[] {
                AdminUser.STATUS_ACTIVE,
                AdminUser.STATUS_BANNED,
                AdminUser.STATUS_RESTRICTED
        };

        new AlertDialog.Builder(this)
                .setTitle(R.string.admin_change_user_status)
                .setItems(statuses, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        AdminUserManager.updateStatus(user.getId(), statuses[which]);
                        Toast.makeText(AdminBackendActivity.this,
                                R.string.admin_user_status_changed, Toast.LENGTH_SHORT).show();
                        renderUserList();
                        renderSummary();
                    }
                })
                .show();
    }

    // ── Exhibitions tab ─────────────────────────────────────────────

    private void renderExhibitionList() {
        exhibitionsSection.removeAllViews();
        exhibitionDetailPanel.setVisibility(View.GONE);

        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();

        addText(exhibitionsSection, getString(R.string.admin_tab_exhibitions),
                R.color.text_primary, 20, Typeface.BOLD);

        if (exhibitions.isEmpty()) {
            addText(exhibitionsSection, "暂无展会数据。",
                    R.color.text_secondary, 15, Typeface.NORMAL);
            return;
        }

        for (final ExhibitorExhibition exh : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            card.setBackgroundResource(R.color.card_background);

            // Title
            addText(card, exh.getTitle(), R.color.text_primary, 17, Typeface.BOLD);

            // Info line
            addText(card, getString(R.string.admin_exhibition_day_label, exh.getDay())
                            + " " + exh.getTime() + " · " + exh.getVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);

            // Status line
            int statusColor = exh.isOpenForRegistration()
                    ? R.color.status_open : R.color.status_closed;
            addText(card, exh.getStatus() + " · " + exh.getCategory(),
                    statusColor, 14, Typeface.BOLD);

            // Action buttons row
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            // Detail button
            Button detailBtn = new Button(this);
            detailBtn.setAllCaps(false);
            detailBtn.setText(R.string.admin_exhibition_detail_title);
            detailBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showExhibitionDetail(exh);
                }
            });
            LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            detailParams.setMargins(0, 0, dp(4), 0);
            actions.addView(detailBtn, detailParams);

            // Status button
            Button statusBtn = new Button(this);
            statusBtn.setAllCaps(false);
            statusBtn.setText(R.string.admin_change_exhibition_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showExhibitionStatusDialog(exh);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, dp(4), 0);
            actions.addView(statusBtn, statusParams);

            // Lock/Unlock button
            Button lockBtn = new Button(this);
            lockBtn.setAllCaps(false);
            lockBtn.setText(exh.isOpenForRegistration()
                    ? R.string.admin_lock_exhibition
                    : R.string.admin_unlock_exhibition);
            lockBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    toggleExhibitionLock(exh);
                }
            });
            LinearLayout.LayoutParams lockParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lockParams.setMargins(dp(4), 0, 0, 0);
            actions.addView(lockBtn, lockParams);

            card.addView(actions, fullWidthParams(8));

            exhibitionsSection.addView(card, fullWidthParams(10));
        }
    }

    private void showExhibitionDetail(final ExhibitorExhibition exh) {
        exhibitionDetailPanel.setVisibility(View.VISIBLE);
        exhibitionDetailPanel.removeAllViews();

        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);

        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_title) + "：" + exh.getTitle(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_venue) + "：" + exh.getVenue(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_date) + "：6月" + exh.getDay() + "日",
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_time) + "：" + exh.getTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        int statusColor = exh.isOpenForRegistration()
                ? R.color.status_open : R.color.status_closed;
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_status) + "：" + exh.getStatus(),
                statusColor, 15, Typeface.BOLD);

        // Action buttons
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);

        Button statusBtn = new Button(this);
        statusBtn.setAllCaps(false);
        statusBtn.setText(R.string.admin_change_exhibition_status);
        statusBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showExhibitionStatusDialog(exh);
            }
        });
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(0, dp(8), dp(4), 0);
        actions.addView(statusBtn, statusParams);

        Button lockBtn = new Button(this);
        lockBtn.setAllCaps(false);
        lockBtn.setText(exh.isOpenForRegistration()
                ? R.string.admin_lock_exhibition
                : R.string.admin_unlock_exhibition);
        lockBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleExhibitionLock(exh);
            }
        });
        LinearLayout.LayoutParams lockParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lockParams.setMargins(dp(4), dp(8), dp(4), 0);
        actions.addView(lockBtn, lockParams);

        Button closeBtn = new Button(this);
        closeBtn.setAllCaps(false);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                exhibitionDetailPanel.setVisibility(View.GONE);
            }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        closeParams.setMargins(dp(4), dp(8), 0, 0);
        actions.addView(closeBtn, closeParams);

        exhibitionDetailPanel.addView(actions, fullWidthParams(0));
    }

    private void showExhibitionStatusDialog(final ExhibitorExhibition exh) {
        final String[] statuses = new String[] {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };

        new AlertDialog.Builder(this)
                .setTitle(R.string.admin_change_exhibition_status)
                .setItems(statuses, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        ExhibitionManager.updateStatus(exh.getId(), statuses[which]);
                        Toast.makeText(AdminBackendActivity.this,
                                R.string.admin_exhibition_status_changed, Toast.LENGTH_SHORT).show();
                        renderExhibitionList();
                        renderSummary();
                    }
                })
                .show();
    }

    private void toggleExhibitionLock(ExhibitorExhibition exh) {
        if (exh.isOpenForRegistration()) {
            // Lock: change to closed
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_CLOSED);
            Toast.makeText(this, R.string.admin_exhibition_locked, Toast.LENGTH_SHORT).show();
        } else {
            // Unlock: change to open
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_OPEN);
            Toast.makeText(this, R.string.admin_exhibition_unlocked, Toast.LENGTH_SHORT).show();
        }
        renderExhibitionList();
        renderSummary();
    }

    // ── Settings tab ────────────────────────────────────────────────

    private void renderSettings() {
        settingsSection.removeAllViews();

        addText(settingsSection, getString(R.string.admin_settings_title),
                R.color.text_primary, 20, Typeface.BOLD);

        addText(settingsSection, getString(R.string.admin_settings_media_limit),
                R.color.text_primary, 17, Typeface.BOLD);

        // Image limit
        addText(settingsSection, getString(R.string.admin_settings_image_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText imageLimitInput = new EditText(this);
        imageLimitInput.setSingleLine(true);
        imageLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        imageLimitInput.setText("10");
        settingsSection.addView(imageLimitInput, fullWidthParams(4));

        // Video limit
        addText(settingsSection, getString(R.string.admin_settings_video_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText videoLimitInput = new EditText(this);
        videoLimitInput.setSingleLine(true);
        videoLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        videoLimitInput.setText("100");
        settingsSection.addView(videoLimitInput, fullWidthParams(4));

        // Gallery limit
        addText(settingsSection, getString(R.string.admin_settings_gallery_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText galleryLimitInput = new EditText(this);
        galleryLimitInput.setSingleLine(true);
        galleryLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        galleryLimitInput.setText("50");
        settingsSection.addView(galleryLimitInput, fullWidthParams(4));

        // Hint text
        addText(settingsSection, getString(R.string.admin_settings_hint),
                R.color.text_secondary, 13, Typeface.NORMAL);

        // Save button
        Button saveBtn = new Button(this);
        saveBtn.setAllCaps(false);
        saveBtn.setText(R.string.admin_settings_save);
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Toast.makeText(AdminBackendActivity.this,
                        R.string.admin_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        settingsSection.addView(saveBtn, fullWidthParams(14));
    }

    // ── Helpers (same pattern as ExhibitorBackendActivity) ──────────

    private TextView addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style) {
        TextView textView = new TextView(this);
        textView.setText(text);
        textView.setTextColor(getResources().getColor(colorRes));
        textView.setTextSize(sizeSp);
        textView.setTypeface(Typeface.DEFAULT, style);
        textView.setLineSpacing(0, 1.15f);
        parent.addView(textView, fullWidthParams(6));
        return textView;
    }

    private LinearLayout.LayoutParams fullWidthParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}
