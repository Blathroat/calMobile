package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * Admin backend activity.
 * Allows administrators to manage users, exhibitions, and system settings.
 * All data is in-memory only (current session).
 */
public class AdminBackendActivity extends BaseActivity {

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
    private ScrollView scrollView;
    private LinearLayout statusPickerPanel;
    private String currentUserDetailId;
    private String currentExhibitionDetailId;

    private int currentTab = TAB_USERS;
    private Button[] tabButtons;

    private interface StatusSelectionHandler {
        void onStatusSelected(String status);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canAccessAdmin()) {
            Toast.makeText(this, R.string.auth_admin_required, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        setContentView(R.layout.activity_admin_backend);

        scrollView = (ScrollView) ((ViewGroup) findViewById(android.R.id.content)).getChildAt(0);
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
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        buildTabRow();
        switchTab(TAB_USERS);
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Section animation ─────────────────────────────────────────────

    /**
     * Animate a section into view with a slide-from-right effect.
     *
     * @param section the View to animate in
     */
    private void animateShowSection(final View section) {
        section.setVisibility(View.VISIBLE);
        section.setAlpha(0f);
        section.setTranslationX(dp(24));
        section.animate()
                .alpha(1f)
                .translationX(0)
                .setDuration(280)
                .setInterpolator(new DecelerateInterpolator())
                .start();
    }

    private void hidePanelImmediately(final View panel) {
        panel.animate().cancel();
        panel.setVisibility(View.GONE);
        panel.setAlpha(1f);
        panel.setTranslationY(0);
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

        // Update tab button appearance with new design system
        for (int i = 0; i < tabButtons.length; i++) {
            if (i == tabIndex) {
                tabButtons[i].setTextColor(getResources().getColor(R.color.tab_active_text));
                GradientDrawable activeBg = new GradientDrawable();
                activeBg.setColor(getResources().getColor(R.color.tab_active_bg));
                activeBg.setCornerRadius(dp(8));
                tabButtons[i].setBackground(activeBg);
                tabButtons[i].setElevation(dp(2));
            } else {
                tabButtons[i].setTextColor(getResources().getColor(R.color.tab_inactive_text));
                GradientDrawable inactiveBg = new GradientDrawable();
                inactiveBg.setColor(getResources().getColor(R.color.tab_inactive_bg));
                inactiveBg.setCornerRadius(dp(8));
                tabButtons[i].setBackground(inactiveBg);
                tabButtons[i].setElevation(0);
            }
        }

        // Hide all sections and detail panels
        removeStatusPickerPanel();
        usersSection.setVisibility(View.GONE);
        hidePanelImmediately(userDetailPanel);
        exhibitionsSection.setVisibility(View.GONE);
        hidePanelImmediately(exhibitionDetailPanel);
        settingsSection.setVisibility(View.GONE);

        // Animate in the active section
        if (tabIndex == TAB_USERS) {
            animateShowSection(usersSection);
            renderUserList();
        } else if (tabIndex == TAB_EXHIBITIONS) {
            animateShowSection(exhibitionsSection);
            renderExhibitionList();
        } else if (tabIndex == TAB_SETTINGS) {
            animateShowSection(settingsSection);
            renderSettings();
        }

        // Render summary
        renderSummary();
    }

    // ── Summary bar ─────────────────────────────────────────────────

    private void renderSummary() {
        summarySection.removeAllViews();
        styleCard(summarySection);

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
        currentUserDetailId = null;
        hidePanelImmediately(userDetailPanel);

        List<AdminUser> users = AdminUserManager.listAll();

        addText(usersSection, getString(R.string.admin_tab_users),
                R.color.text_primary, 20, Typeface.BOLD);

        // Export users button
        Button exportUsersBtn = new Button(this);
        styleSecondaryButton(exportUsersBtn);
        exportUsersBtn.setText(R.string.export_users);
        exportUsersBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportUsers(AdminBackendActivity.this);
                showExportResult(path);
            }
        });
        usersSection.addView(exportUsersBtn, fullWidthParams(8));

        if (users.isEmpty()) {
            showEmptyState(usersSection, getString(R.string.empty_users_generic));
            return;
        }

        for (final AdminUser user : users) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

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
            styleSecondaryButton(detailBtn);
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
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.admin_change_user_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showUserStatusPicker(card, user);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, 0, 0);
            actions.addView(statusBtn, statusParams);

            card.addView(actions, fullWidthParams(8));

            usersSection.addView(card, fullWidthParams(10));
        }

        animateListItems(usersSection, 100);
    }

    private void showUserDetail(final AdminUser user) {
        currentUserDetailId = user.getId();
        userDetailPanel.animate().cancel();
        userDetailPanel.removeAllViews();
        animateShowPanel(userDetailPanel);

        addText(userDetailPanel, getString(R.string.admin_user_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(userDetailPanel, getString(R.string.admin_user_label_nickname) + "：" + user.getNickname(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(userDetailPanel, getString(R.string.admin_user_label_email) + "：" + user.getEmail(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        int statusColor = user.isActive() ? R.color.status_open
                : (user.isBanned() ? R.color.status_closed : R.color.status_pending);
        addText(userDetailPanel, getString(R.string.admin_user_label_status) + "：" + user.getStatus(),
                statusColor, 15, Typeface.BOLD);
        addText(userDetailPanel, getString(R.string.admin_user_label_reg_time) + "：" + user.getRegistrationTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(userDetailPanel, getString(R.string.admin_user_label_last_login) + "：" + user.getLastLoginTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button statusBtn = new Button(this);
        styleSecondaryButton(statusBtn);
        statusBtn.setText(R.string.admin_change_user_status);
        statusBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showUserStatusPicker(userDetailPanel, user); }
        });
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(0, dp(8), dp(4), 0);
        actions.addView(statusBtn, statusParams);

        Button closeBtn = new Button(this);
        styleSecondaryButton(closeBtn);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                currentUserDetailId = null;
                animateHidePanel(userDetailPanel);
            }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        closeParams.setMargins(dp(4), dp(8), 0, 0);
        actions.addView(closeBtn, closeParams);
        userDetailPanel.addView(actions, fullWidthParams(0));
        scrollToView(userDetailPanel);
    }
    private void showUserStatusPicker(final LinearLayout cardHost, final AdminUser user) {
        final boolean restoreDetail = userDetailPanel.getVisibility() == View.VISIBLE
                && user.getId().equals(currentUserDetailId);
        LinearLayout pickerHost = restoreDetail ? userDetailPanel : cardHost;
        final String[] statuses = new String[] {
                AdminUser.STATUS_ACTIVE,
                AdminUser.STATUS_BANNED,
                AdminUser.STATUS_RESTRICTED
        };

        showStatusPickerPanel(pickerHost, getString(R.string.admin_change_user_status),
                statuses, user.getStatus(), new StatusSelectionHandler() {
                    @Override
                    public void onStatusSelected(String status) {
                        AdminUserManager.updateStatus(user.getId(), status);
                        Toast.makeText(AdminBackendActivity.this,
                                R.string.admin_user_status_changed, Toast.LENGTH_SHORT).show();
                        renderUserList();
                        renderSummary();
                        if (restoreDetail) {
                            AdminUser updated = AdminUserManager.findById(user.getId());
                            if (updated != null) {
                                showUserDetail(updated);
                            }
                        }
                    }
                });
    }

    // ── Exhibitions tab ─────────────────────────────────────────────

    private void renderExhibitionList() {
        exhibitionsSection.removeAllViews();
        currentExhibitionDetailId = null;
        hidePanelImmediately(exhibitionDetailPanel);

        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();

        addText(exhibitionsSection, getString(R.string.admin_tab_exhibitions),
                R.color.text_primary, 20, Typeface.BOLD);

        // Export exhibitions button
        Button exportExhBtn = new Button(this);
        styleSecondaryButton(exportExhBtn);
        exportExhBtn.setText(R.string.export_exhibitions);
        exportExhBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportExhibitions(AdminBackendActivity.this);
                showExportResult(path);
            }
        });
        exhibitionsSection.addView(exportExhBtn, fullWidthParams(8));

        if (exhibitions.isEmpty()) {
            showEmptyState(exhibitionsSection, getString(R.string.empty_exhibitions_generic));
            return;
        }

        for (final ExhibitorExhibition exh : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            // Title
            addText(card, exh.getTitle(), R.color.text_primary, 17, Typeface.BOLD);

            // Info line
            addText(card, getString(R.string.admin_exhibition_day_label, exh.getDay())
                            + " " + exh.getTime() + " · " + exh.getVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);

            // Status line
            TextView statusBadge = createStatusBadge(exh.getStatus() + " · " + exh.getCategory(),
                    exh.isOpenForRegistration());
            card.addView(statusBadge, fullWidthParams(6));

            // Action buttons row
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            // Detail button
            Button detailBtn = new Button(this);
            styleSecondaryButton(detailBtn);
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
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.admin_change_exhibition_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showExhibitionStatusPicker(card, exh);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, dp(4), 0);
            actions.addView(statusBtn, statusParams);

            // Lock/Unlock button
            Button lockBtn = new Button(this);
            styleSecondaryButton(lockBtn);
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

        animateListItems(exhibitionsSection, 100);
    }

    private void showExhibitionDetail(final ExhibitorExhibition exh) {
        currentExhibitionDetailId = exh.getId();
        exhibitionDetailPanel.animate().cancel();
        exhibitionDetailPanel.removeAllViews();
        animateShowPanel(exhibitionDetailPanel);

        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_detail_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_title) + "：" + exh.getTitle(),
                R.color.text_primary, 16, Typeface.BOLD);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_venue) + "：" + exh.getVenue(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_date) + "："
                        + ExhibitionConfiguration.displayDate(exh.getId(), exh.getDay()),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_time) + "：" + exh.getTime(),
                R.color.text_secondary, 15, Typeface.NORMAL);
        int statusColor = exh.isOpenForRegistration() ? R.color.status_open : R.color.status_closed;
        addText(exhibitionDetailPanel, getString(R.string.admin_exhibition_label_status) + "：" + exh.getStatus(),
                statusColor, 15, Typeface.BOLD);

        LinearLayout manageRow = new LinearLayout(this);
        manageRow.setOrientation(LinearLayout.HORIZONTAL);
        Button editBtn = new Button(this);
        styleSecondaryButton(editBtn);
        editBtn.setText(R.string.exhibitor_edit_exhibition);
        editBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Intent intent = new Intent(AdminBackendActivity.this, ExhibitionFormActivity.class);
                intent.putExtra(ExhibitionFormActivity.EXTRA_EXHIBITION_ID, exh.getId());
                startActivity(intent);
                overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
            }
        });
        LinearLayout.LayoutParams editParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        editParams.setMargins(0, dp(8), dp(4), 0);
        manageRow.addView(editBtn, editParams);
        Button registrationsBtn = new Button(this);
        styleSecondaryButton(registrationsBtn);
        registrationsBtn.setText(R.string.reg_mgmt_nav_btn);
        registrationsBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Intent intent = new Intent(AdminBackendActivity.this, RegistrationManagementActivity.class);
                intent.putExtra(RegistrationManagementActivity.EXTRA_EXHIBITION_ID, exh.getId());
                startActivity(intent);
                overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
            }
        });
        LinearLayout.LayoutParams registrationsParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        registrationsParams.setMargins(dp(4), dp(8), 0, 0);
        manageRow.addView(registrationsBtn, registrationsParams);
        exhibitionDetailPanel.addView(manageRow, fullWidthParams(0));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button statusBtn = new Button(this);
        styleSecondaryButton(statusBtn);
        statusBtn.setText(R.string.admin_change_exhibition_status);
        statusBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showExhibitionStatusPicker(exhibitionDetailPanel, exh); }
        });
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(0, dp(8), dp(4), 0);
        actions.addView(statusBtn, statusParams);
        Button lockBtn = new Button(this);
        styleSecondaryButton(lockBtn);
        lockBtn.setText(exh.isOpenForRegistration() ? R.string.admin_lock_exhibition : R.string.admin_unlock_exhibition);
        lockBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleExhibitionLock(exh); }
        });
        LinearLayout.LayoutParams lockParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lockParams.setMargins(dp(4), dp(8), dp(4), 0);
        actions.addView(lockBtn, lockParams);
        Button closeBtn = new Button(this);
        styleSecondaryButton(closeBtn);
        closeBtn.setText(R.string.admin_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { currentExhibitionDetailId = null; animateHidePanel(exhibitionDetailPanel); }
        });
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        closeParams.setMargins(dp(4), dp(8), 0, 0);
        actions.addView(closeBtn, closeParams);
        exhibitionDetailPanel.addView(actions, fullWidthParams(8));
        scrollToView(exhibitionDetailPanel);
    }
    private void showExhibitionStatusPicker(final LinearLayout cardHost,
                                             final ExhibitorExhibition exh) {
        final boolean restoreDetail = exhibitionDetailPanel.getVisibility() == View.VISIBLE
                && exh.getId().equals(currentExhibitionDetailId);
        LinearLayout pickerHost = restoreDetail ? exhibitionDetailPanel : cardHost;
        final String[] statuses = new String[] {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };

        showStatusPickerPanel(pickerHost, getString(R.string.admin_change_exhibition_status),
                statuses, exh.getStatus(), new StatusSelectionHandler() {
                    @Override
                    public void onStatusSelected(String status) {
                        ExhibitionManager.updateStatus(exh.getId(), status);
                        Toast.makeText(AdminBackendActivity.this,
                                R.string.admin_exhibition_status_changed, Toast.LENGTH_SHORT).show();
                        renderExhibitionList();
                        renderSummary();
                        if (restoreDetail) {
                            ExhibitorExhibition updated = ExhibitionManager.findById(exh.getId());
                            if (updated != null) {
                                showExhibitionDetail(updated);
                            }
                        }
                    }
                });
    }

    private void toggleExhibitionLock(ExhibitorExhibition exh) {
        boolean restoreDetail = exhibitionDetailPanel.getVisibility() == View.VISIBLE
                && exh.getId().equals(currentExhibitionDetailId);
        if (exh.isOpenForRegistration()) {
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_CLOSED);
            Toast.makeText(this, R.string.admin_exhibition_locked, Toast.LENGTH_SHORT).show();
        } else {
            ExhibitionManager.updateStatus(exh.getId(), ExhibitorExhibition.STATUS_OPEN);
            Toast.makeText(this, R.string.admin_exhibition_unlocked, Toast.LENGTH_SHORT).show();
        }
        renderExhibitionList();
        renderSummary();
        if (restoreDetail) {
            ExhibitorExhibition updated = ExhibitionManager.findById(exh.getId());
            if (updated != null) {
                showExhibitionDetail(updated);
            }
        }
    }

    private void showStatusPickerPanel(LinearLayout pickerHost, String title, String[] statuses,
            String currentStatus, final StatusSelectionHandler handler) {
        removeStatusPickerPanel();

        LinearLayout pickerCard = new LinearLayout(this);
        pickerCard.setOrientation(LinearLayout.VERTICAL);
        pickerCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(pickerCard);
        statusPickerPanel = pickerCard;

        addText(pickerCard, title, R.color.text_primary, 17, Typeface.BOLD);

        for (final String status : statuses) {
            Button optionBtn = new Button(this);
            optionBtn.setAllCaps(false);
            optionBtn.setText(status);
            optionBtn.setTextSize(15);
            optionBtn.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            optionBtn.setPadding(dp(12), dp(10), dp(12), dp(10));
            optionBtn.setStateListAnimator(null);
            optionBtn.setElevation(0);
            styleStatusOptionButton(optionBtn, status.equals(currentStatus));
            optionBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    removeStatusPickerPanel();
                    handler.onStatusSelected(status);
                }
            });
            pickerCard.addView(optionBtn, fullWidthParams(4));
        }

        Button cancelBtn = new Button(this);
        styleSecondaryButton(cancelBtn);
        cancelBtn.setText(R.string.admin_close_detail);
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                removeStatusPickerPanel();
            }
        });
        pickerCard.addView(cancelBtn, fullWidthParams(8));

        pickerHost.addView(pickerCard, fullWidthParams(10));
        scrollToView(pickerCard);
    }

    private void styleStatusOptionButton(Button optionBtn, boolean selected) {
        GradientDrawable optionBg = new GradientDrawable();
        optionBg.setCornerRadius(dp(8));
        if (selected) {
            optionBg.setColor(getResources().getColor(R.color.tab_active_bg));
            optionBtn.setTextColor(getResources().getColor(R.color.tab_active_text));
        } else {
            optionBg.setColor(getResources().getColor(R.color.card_background));
            optionBg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
            optionBtn.setTextColor(getResources().getColor(R.color.text_primary));
        }
        optionBtn.setBackground(optionBg);
    }

    private void removeStatusPickerPanel() {
        if (statusPickerPanel != null) {
            if (statusPickerPanel.getParent() instanceof ViewGroup) {
                ((ViewGroup) statusPickerPanel.getParent()).removeView(statusPickerPanel);
            }
            statusPickerPanel = null;
        }
    }

    private void scrollToView(final View target) {
        if (scrollView == null || target == null) {
            return;
        }
        scrollView.postDelayed(new Runnable() {
            @Override
            public void run() {
                int scrollY = getTopRelativeToScrollView(target) - dp(12);
                scrollView.smoothScrollTo(0, Math.max(0, scrollY));
            }
        }, 120);
    }

    private int getTopRelativeToScrollView(View target) {
        int top = target.getTop();
        ViewParent parent = target.getParent();
        while (parent instanceof View && parent != scrollView) {
            View parentView = (View) parent;
            top += parentView.getTop();
            parent = parentView.getParent();
        }
        return top;
    }

    // ── Settings tab ────────────────────────────────────────────────

    private void renderSettings() {
        settingsSection.removeAllViews();

        addText(settingsSection, getString(R.string.admin_settings_title),
                R.color.text_primary, 20, Typeface.BOLD);

        addText(settingsSection, "应用配色", R.color.text_primary, 17, Typeface.BOLD);
        final int[] selectedTheme = {AppSettings.getThemeIndex(this)};
        LinearLayout colorRow = new LinearLayout(this);
        colorRow.setOrientation(LinearLayout.HORIZONTAL);
        int[] accentColors = AppSettings.getAccentColors();
        for (int i = 0; i < accentColors.length; i++) {
            final int index = i;
            Button colorButton = new Button(this);
            colorButton.setText(String.format("#%06X", (0xFFFFFF & accentColors[i])));
            colorButton.setTextSize(10);
            colorButton.setTextColor(getResources().getColor(android.R.color.white));
            GradientDrawable swatch = new GradientDrawable();
            swatch.setColor(accentColors[i]);
            swatch.setShape(GradientDrawable.OVAL);
            swatch.setStroke(dp(index == selectedTheme[0] ? 3 : 1),
                    getResources().getColor(index == selectedTheme[0]
                            ? R.color.text_primary : R.color.card_stroke));
            colorButton.setBackground(swatch);
            colorButton.setContentDescription("配色 " + (i + 1));
            colorButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    selectedTheme[0] = index;
                    AppSettings.setThemeIndex(AdminBackendActivity.this, index);
                    AppSettings.applyWindowColors(AdminBackendActivity.this);
                    for (int j = 0; j < colorRow.getChildCount(); j++) {
                        View child = colorRow.getChildAt(j);
                        if (child instanceof Button && child.getBackground() instanceof GradientDrawable) {
                            ((GradientDrawable) child.getBackground()).setStroke(dp(j == index ? 3 : 1),
                                    getResources().getColor(j == index ? R.color.text_primary : R.color.card_stroke));
                        }
                    }
                    Toast.makeText(AdminBackendActivity.this, "配色已更新", Toast.LENGTH_SHORT).show();
                }
            });
            LinearLayout.LayoutParams colorParams = new LinearLayout.LayoutParams(dp(52), dp(52));
            colorParams.setMargins(dp(4), 0, dp(4), 0);
            colorRow.addView(colorButton, colorParams);
        }
        android.widget.HorizontalScrollView colorScroll = new android.widget.HorizontalScrollView(this);
        colorScroll.setHorizontalScrollBarEnabled(false);
        colorScroll.addView(colorRow, new android.widget.HorizontalScrollView.LayoutParams(
                android.widget.HorizontalScrollView.LayoutParams.WRAP_CONTENT,
                android.widget.HorizontalScrollView.LayoutParams.WRAP_CONTENT));
        settingsSection.addView(colorScroll, fullWidthParams(6));

        addText(settingsSection, "进入应用时的公告", R.color.text_primary, 17, Typeface.BOLD);
        final EditText announcementInput = new EditText(this);
        styleInputField(announcementInput);
        announcementInput.setSingleLine(false);
        announcementInput.setMinLines(2);
        announcementInput.setHint("例如：本周末展馆开放时间调整");
        announcementInput.setText(AppSettings.getAnnouncement(this));
        settingsSection.addView(announcementInput, fullWidthParams(4));
        final CheckBox announcementToggle = new CheckBox(this);
        announcementToggle.setText("进入应用时显示公告");
        announcementToggle.setChecked(AppSettings.isAnnouncementEnabled(this));
        settingsSection.addView(announcementToggle, fullWidthParams(2));

        addText(settingsSection, "展会分类管理", R.color.text_primary, 17, Typeface.BOLD);
        final EditText categoriesInput = new EditText(this);
        styleInputField(categoriesInput);
        categoriesInput.setSingleLine(false);
        categoriesInput.setHint("每行一个分类，例如：智能家居");
        categoriesInput.setText(android.text.TextUtils.join("\n", AppSettings.getCategories(this)));
        settingsSection.addView(categoriesInput, fullWidthParams(4));

        final CheckBox reviewToggle = new CheckBox(this);
        reviewToggle.setText("允许修改已通过或已拒绝的报名");
        reviewToggle.setChecked(AppSettings.canReviseReviewedRegistration(this));
        settingsSection.addView(reviewToggle, fullWidthParams(2));

        // Data export section
        addText(settingsSection, "数据导出",
                R.color.text_primary, 17, Typeface.BOLD);

        LinearLayout exportRow = new LinearLayout(this);
        exportRow.setOrientation(LinearLayout.HORIZONTAL);

        Button exportExhBtn = new Button(this);
        styleSecondaryButton(exportExhBtn);
        exportExhBtn.setText(R.string.export_exhibitions);
        exportExhBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportExhibitions(AdminBackendActivity.this);
                showExportResult(path);
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
                String path = ExportManager.exportRegistrations(AdminBackendActivity.this);
                showExportResult(path);
            }
        });
        LinearLayout.LayoutParams regParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        regParams.setMargins(dp(4), 0, 0, 0);
        exportRow.addView(exportRegBtn, regParams);

        settingsSection.addView(exportRow, fullWidthParams(8));

        Button exportUsersBtn = new Button(this);
        styleSecondaryButton(exportUsersBtn);
        exportUsersBtn.setText(R.string.export_users);
        exportUsersBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportUsers(AdminBackendActivity.this);
                showExportResult(path);
            }
        });
        settingsSection.addView(exportUsersBtn, fullWidthParams(4));

        addText(settingsSection, getString(R.string.admin_settings_media_limit),
                R.color.text_primary, 17, Typeface.BOLD);

        // Image limit
        addText(settingsSection, getString(R.string.admin_settings_image_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText imageLimitInput = new EditText(this);
        styleInputField(imageLimitInput);
        imageLimitInput.setSingleLine(true);
        imageLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        imageLimitInput.setText("10");
        settingsSection.addView(imageLimitInput, fullWidthParams(4));

        // Video limit
        addText(settingsSection, getString(R.string.admin_settings_video_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText videoLimitInput = new EditText(this);
        styleInputField(videoLimitInput);
        videoLimitInput.setSingleLine(true);
        videoLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        videoLimitInput.setText("100");
        settingsSection.addView(videoLimitInput, fullWidthParams(4));

        // Gallery limit
        addText(settingsSection, getString(R.string.admin_settings_gallery_limit),
                R.color.text_secondary, 14, Typeface.NORMAL);
        final EditText galleryLimitInput = new EditText(this);
        styleInputField(galleryLimitInput);
        galleryLimitInput.setSingleLine(true);
        galleryLimitInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        galleryLimitInput.setText("50");
        settingsSection.addView(galleryLimitInput, fullWidthParams(4));

        // Hint text
        addText(settingsSection, getString(R.string.admin_settings_hint),
                R.color.text_secondary, 13, Typeface.NORMAL);

        // Save button
        Button saveBtn = new Button(this);
        stylePrimaryButton(saveBtn);
        saveBtn.setText(R.string.admin_settings_save);
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AppSettings.setThemeIndex(AdminBackendActivity.this, selectedTheme[0]);
                AppSettings.saveAnnouncement(AdminBackendActivity.this,
                        announcementInput.getText().toString(), announcementToggle.isChecked());
                java.util.ArrayList<String> categories = new java.util.ArrayList<>();
                for (String item : categoriesInput.getText().toString().split("\\n")) {
                    if (!item.trim().isEmpty()) categories.add(item.trim());
                }
                if (!categories.isEmpty()) AppSettings.saveCategories(AdminBackendActivity.this, categories);
                AppSettings.setCanReviseReviewedRegistration(AdminBackendActivity.this, reviewToggle.isChecked());
                Toast.makeText(AdminBackendActivity.this,
                        R.string.admin_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        settingsSection.addView(saveBtn, fullWidthParams(14));

        // Stagger settings items
        animateListItems(settingsSection, 80);
    }

    // ── Export result helper ────────────────────────────────────────

    private void showExportResult(String path) {
        if (path != null) {
            Toast.makeText(this,
                    getString(R.string.export_success, path),
                    Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, R.string.export_empty, Toast.LENGTH_SHORT).show();
        }
    }
}
