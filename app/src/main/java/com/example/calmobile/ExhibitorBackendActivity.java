package com.example.calmobile;

import android.content.Intent;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * Exhibitor backend activity.
 * Allows exhibitors to manage their exhibitions: view, add, edit, delete,
 * change status, and view registration records.
 */
public class ExhibitorBackendActivity extends BaseActivity {

    private static final int REQUEST_EXHIBITION_FORM = 1001;

    private LinearLayout listContainer;
    private LinearLayout registrationsPanel;
    private LinearLayout statusPickerCard;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canAccessExhibitor()) {
            Toast.makeText(this, R.string.auth_exhibitor_required, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        setContentView(R.layout.activity_exhibitor_backend);

        listContainer = findViewById(R.id.exhibitor_list);
        registrationsPanel = findViewById(R.id.exhibitor_registrations_panel);

        // Ensure sample data is seeded
        ExhibitionManager.ensureInitialized();

        // Back button
        TextView backBtn = findViewById(R.id.exhibitor_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        // Add button
        Button addBtn = findViewById(R.id.exhibitor_add_btn);
        stylePrimaryButton(addBtn);
        addBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openForm(null);
            }
        });

        renderList();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_EXHIBITION_FORM) {
            renderList();
        }
    }

    private void openForm(String exhibitionId) {
        Intent intent = new Intent(this, ExhibitionFormActivity.class);
        if (exhibitionId != null) {
            intent.putExtra(ExhibitionFormActivity.EXTRA_EXHIBITION_ID, exhibitionId);
        }
        startActivityForResult(intent, REQUEST_EXHIBITION_FORM);
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
    }

    // ── List rendering ───────────────────────────────────────────────

    private void renderList() {
        listContainer.removeAllViews();
        animateHidePanel(registrationsPanel);

        List<ExhibitorExhibition> exhibitions = ExhibitionManager.listAll();

        if (exhibitions.isEmpty()) {
            showEmptyState(listContainer, getString(R.string.exhibitor_backend_empty));
            return;
        }

        for (final ExhibitorExhibition exh : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            // Title row
            addText(card, exh.getTitle(), R.color.text_primary, 17, Typeface.BOLD);

            // Info line
            addText(card, getString(R.string.exhibitor_day_label, exh.getDay())
                            + " " + exh.getTime() + " · " + exh.getVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);

            // Status line
            TextView statusBadge = createStatusBadge(exh.getStatus() + " · " + exh.getCategory(),
                    exh.isOpenForRegistration());
            card.addView(statusBadge, fullWidthParams(6));

            // Action buttons row
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button registrationsBtn = new Button(this);
            styleSecondaryButton(registrationsBtn);
            registrationsBtn.setText(R.string.reg_mgmt_nav_btn);
            registrationsBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    // Open registration management directly
                    Intent intent = new Intent(ExhibitorBackendActivity.this,
                            RegistrationManagementActivity.class);
                    intent.putExtra(RegistrationManagementActivity.EXTRA_EXHIBITION_ID,
                            exh.getId());
                    startActivity(intent);
                    overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
                }
            });
            LinearLayout.LayoutParams registrationsParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            registrationsParams.setMargins(0, 0, dp(4), 0);
            actions.addView(registrationsBtn, registrationsParams);

            // Status button
            Button statusBtn = new Button(this);
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.exhibitor_change_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showStatusPicker(card, exh);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, 0, 0);
            actions.addView(statusBtn, statusParams);

            card.addView(actions, fullWidthParams(8));

            // 删除仍使用清晰文字，避免图标含义不明确；背景沿用 button_danger_bg 令牌。
            Button deleteBtn = new Button(this);
            styleDangerButton(deleteBtn);
            deleteBtn.setText(R.string.exhibitor_delete);
            deleteBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    confirmDelete(exh);
                }
            });
            LinearLayout.LayoutParams deleteParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            deleteParams.setMargins(dp(8), 0, 0, 0);
            card.addView(deleteBtn, deleteParams);

            listContainer.addView(card, fullWidthParams(10));
        }

        animateListItems(listContainer, 100);
    }

    // ── Status management ────────────────────────────────────────────

    private void showStatusPicker(final LinearLayout host, final ExhibitorExhibition exh) {
        if (statusPickerCard != null && statusPickerCard.getParent() instanceof LinearLayout) {
            ((LinearLayout) statusPickerCard.getParent()).removeView(statusPickerCard);
        }

        statusPickerCard = new LinearLayout(this);
        statusPickerCard.setOrientation(LinearLayout.VERTICAL);
        statusPickerCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        styleCard(statusPickerCard);

        addText(statusPickerCard, getString(R.string.exhibitor_change_status),
                R.color.text_primary, 17, Typeface.BOLD);

        String[] statuses = new String[] {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };

        for (final String status : statuses) {
            Button optionBtn = new Button(this);
            optionBtn.setAllCaps(false);
            optionBtn.setText(status);
            optionBtn.setTextSize(15);
            optionBtn.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            optionBtn.setPadding(dp(12), dp(10), dp(12), dp(10));

            GradientDrawable optionBg = new GradientDrawable();
            optionBg.setCornerRadius(dp(8));
            if (status.equals(exh.getStatus())) {
                optionBg.setColor(getResources().getColor(R.color.tab_active_bg));
                optionBtn.setTextColor(getResources().getColor(R.color.tab_active_text));
            } else {
                optionBg.setColor(getResources().getColor(R.color.card_background));
                optionBg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
                optionBtn.setTextColor(getResources().getColor(R.color.text_primary));
            }
            optionBtn.setBackground(optionBg);

            optionBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    ExhibitionManager.updateStatus(exh.getId(), status);
                    Toast.makeText(ExhibitorBackendActivity.this,
                            R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();
                    renderList();
                }
            });

            LinearLayout.LayoutParams params = fullWidthParams(6);
            params.setMargins(0, dp(4), 0, 0);
            statusPickerCard.addView(optionBtn, params);
        }

        Button cancelBtn = new Button(this);
        styleSecondaryButton(cancelBtn);
        cancelBtn.setText(R.string.confirm_no);
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                renderList();
            }
        });

        LinearLayout.LayoutParams cancelParams = fullWidthParams(8);
        cancelParams.setMargins(0, dp(8), 0, 0);
        statusPickerCard.addView(cancelBtn, cancelParams);

        host.addView(statusPickerCard, fullWidthParams(8));
        statusPickerCard.requestFocus();
    }

    // ── Delete ───────────────────────────────────────────────────────

    private void confirmDelete(final ExhibitorExhibition exh) {
        showConfirmDialog(getString(R.string.confirm_delete_exhibition), new Runnable() {
            @Override
            public void run() {
                ExhibitionManager.delete(exh.getId());
                Toast.makeText(ExhibitorBackendActivity.this,
                        R.string.exhibitor_deleted, Toast.LENGTH_SHORT).show();
                renderList();
            }
        });
    }

    // ── Registration records ─────────────────────────────────────────

    private void showRegistrations(ExhibitorExhibition exh) {
        animateShowPanel(registrationsPanel);
        registrationsPanel.removeAllViews();

        addText(registrationsPanel, getString(R.string.exhibitor_registrations_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(registrationsPanel, exh.getTitle(),
                R.color.text_secondary, 15, Typeface.NORMAL);

        List<String> records = ExhibitionManager.getRegistrationRecords(exh);

        addText(registrationsPanel,
                getString(R.string.exhibitor_registrations_count, records.size()),
                R.color.text_secondary, 14, Typeface.NORMAL);

        if (records.isEmpty()) {
            addText(registrationsPanel, getString(R.string.exhibitor_registrations_empty),
                    R.color.text_secondary, 14, Typeface.NORMAL);
        } else {
            for (String record : records) {
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(12), dp(10), dp(12), dp(10));
                styleCard(row);
                addText(row, record, R.color.text_primary, 15, Typeface.NORMAL);
                registrationsPanel.addView(row, fullWidthParams(6));
            }
        }

        // Close button
        Button closeBtn = new Button(this);
        styleSecondaryButton(closeBtn);
        closeBtn.setText(R.string.exhibitor_cancel);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                animateHidePanel(registrationsPanel);
            }
        });
        registrationsPanel.addView(closeBtn, fullWidthParams(10));

        animateListItems(registrationsPanel, 150);
    }
}
