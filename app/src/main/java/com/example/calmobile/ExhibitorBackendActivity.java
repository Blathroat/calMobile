package com.example.calmobile;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
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

        // Export buttons row
        LinearLayout exportRow = new LinearLayout(this);
        exportRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams exportRowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        exportRowParams.setMargins(0, dp(8), 0, 0);

        Button exportExhBtn = new Button(this);
        styleSecondaryButton(exportExhBtn);
        exportExhBtn.setText(R.string.export_exhibitions);
        exportExhBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportExhibitions(ExhibitorBackendActivity.this);
                if (path != null) {
                    Toast.makeText(ExhibitorBackendActivity.this,
                            getString(R.string.export_success, path),
                            Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(ExhibitorBackendActivity.this,
                            R.string.export_empty, Toast.LENGTH_SHORT).show();
                }
            }
        });
        LinearLayout.LayoutParams exportExhParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        exportExhParams.setMargins(0, 0, dp(4), 0);
        exportRow.addView(exportExhBtn, exportExhParams);

        Button exportRegBtn = new Button(this);
        styleSecondaryButton(exportRegBtn);
        exportRegBtn.setText(R.string.export_registrations);
        exportRegBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String path = ExportManager.exportRegistrations(ExhibitorBackendActivity.this);
                if (path != null) {
                    Toast.makeText(ExhibitorBackendActivity.this,
                            getString(R.string.export_success, path),
                            Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(ExhibitorBackendActivity.this,
                            R.string.export_empty, Toast.LENGTH_SHORT).show();
                }
            }
        });
        LinearLayout.LayoutParams exportRegParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        exportRegParams.setMargins(dp(4), 0, 0, 0);
        exportRow.addView(exportRegBtn, exportRegParams);

        // Insert export row after the add button
        LinearLayout parent = (LinearLayout) addBtn.getParent();
        int addBtnIndex = parent.indexOfChild(addBtn);
        parent.addView(exportRow, addBtnIndex + 1, exportRowParams);

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
            int statusColor = exh.isOpenForRegistration()
                    ? R.color.status_open : R.color.status_closed;
            addText(card, exh.getStatus() + " · " + exh.getCategory(),
                    statusColor, 14, Typeface.BOLD);

            // Action buttons row
            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            // Edit button
            Button editBtn = new Button(this);
            styleSecondaryButton(editBtn);
            editBtn.setText(R.string.exhibitor_edit_exhibition);
            editBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openForm(exh.getId());
                }
            });
            LinearLayout.LayoutParams editParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            editParams.setMargins(0, 0, dp(4), 0);
            actions.addView(editBtn, editParams);

            // Status button
            Button statusBtn = new Button(this);
            styleSecondaryButton(statusBtn);
            statusBtn.setText(R.string.exhibitor_change_status);
            statusBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showStatusDialog(exh);
                }
            });
            LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            statusParams.setMargins(dp(4), 0, dp(4), 0);
            actions.addView(statusBtn, statusParams);

            // Registrations button
            Button regBtn = new Button(this);
            styleSecondaryButton(regBtn);
            regBtn.setText(R.string.reg_mgmt_nav_btn);
            regBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Intent intent = new Intent(ExhibitorBackendActivity.this,
                            RegistrationManagementActivity.class);
                    intent.putExtra(RegistrationManagementActivity.EXTRA_EXHIBITION_ID,
                            exh.getId());
                    startActivity(intent);
                    overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
                }
            });
            LinearLayout.LayoutParams regParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            regParams.setMargins(dp(4), 0, 0, 0);
            actions.addView(regBtn, regParams);

            card.addView(actions, fullWidthParams(8));

            // Delete button (separate row)
            Button deleteBtn = new Button(this);
            styleDangerButton(deleteBtn);
            deleteBtn.setText(R.string.exhibitor_delete);
            deleteBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    confirmDelete(exh);
                }
            });
            card.addView(deleteBtn, fullWidthParams(4));

            listContainer.addView(card, fullWidthParams(10));
        }

        animateListItems(listContainer, 100);
    }

    // ── Status management ────────────────────────────────────────────

    private void showStatusDialog(final ExhibitorExhibition exh) {
        final String[] statuses = new String[] {
                ExhibitorExhibition.STATUS_OPEN,
                ExhibitorExhibition.STATUS_CLOSED,
                ExhibitorExhibition.STATUS_ENDED
        };

        new AlertDialog.Builder(this)
                .setTitle(R.string.exhibitor_change_status)
                .setItems(statuses, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        ExhibitionManager.updateStatus(exh.getId(), statuses[which]);
                        Toast.makeText(ExhibitorBackendActivity.this,
                                R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();
                        renderList();
                    }
                })
                .show();
    }

    // ── Delete ───────────────────────────────────────────────────────

    private void confirmDelete(final ExhibitorExhibition exh) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.confirm_title)
                .setMessage(R.string.confirm_delete_exhibition)
                .setPositiveButton(R.string.confirm_yes, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        ExhibitionManager.delete(exh.getId());
                        Toast.makeText(ExhibitorBackendActivity.this,
                                R.string.exhibitor_deleted, Toast.LENGTH_SHORT).show();
                        renderList();
                    }
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show();
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
