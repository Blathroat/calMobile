package com.example.calmobile;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * Exhibitor backend activity.
 * Allows exhibitors to manage their exhibitions: view, add, edit, delete,
 * change status, and view registration records.
 */
public class ExhibitorBackendActivity extends BaseActivity {

    private LinearLayout listContainer;
    private LinearLayout formContainer;
    private LinearLayout registrationsPanel;

    /** Form inputs (populated when add/edit is active). */
    private EditText titleInput;
    private EditText venueInput;
    private EditText dayInput;
    private EditText timeInput;
    private EditText categoryInput;
    private EditText descriptionInput;
    private RadioGroup statusGroup;

    /** null = adding new, non-null = editing. */
    private String editingId = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_exhibitor_backend);

        listContainer = findViewById(R.id.exhibitor_list);
        formContainer = findViewById(R.id.exhibitor_form);
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
        addBtn.setAllCaps(false);
        addBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editingId = null;
                showForm(null);
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
        exportExhBtn.setAllCaps(false);
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
        exportRegBtn.setAllCaps(false);
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

    // ── List rendering ───────────────────────────────────────────────

    private void renderList() {
        listContainer.removeAllViews();
        animateHidePanel(formContainer);
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
            editBtn.setAllCaps(false);
            editBtn.setText(R.string.exhibitor_edit_exhibition);
            editBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    editingId = exh.getId();
                    showForm(exh);
                }
            });
            LinearLayout.LayoutParams editParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            editParams.setMargins(0, 0, dp(4), 0);
            actions.addView(editBtn, editParams);

            // Status button
            Button statusBtn = new Button(this);
            statusBtn.setAllCaps(false);
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
            regBtn.setAllCaps(false);
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
            deleteBtn.setAllCaps(false);
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

    // ── Form (add / edit) ────────────────────────────────────────────

    private void showForm(ExhibitorExhibition existing) {
        animateShowPanel(formContainer);
        formContainer.removeAllViews();
        animateHidePanel(registrationsPanel);

        boolean isEdit = existing != null;
        addText(formContainer,
                isEdit ? getString(R.string.exhibitor_edit_exhibition)
                        : getString(R.string.exhibitor_add_exhibition),
                R.color.text_primary, 20, Typeface.BOLD);

        // Title
        addText(formContainer, getString(R.string.exhibitor_field_title),
                R.color.text_secondary, 13, Typeface.BOLD);
        titleInput = new EditText(this);
        titleInput.setSingleLine(true);
        titleInput.setInputType(InputType.TYPE_CLASS_TEXT);
        titleInput.setHint(R.string.exhibitor_hint_title);
        if (isEdit) {
            titleInput.setText(existing.getTitle());
        }
        formContainer.addView(titleInput, fullWidthParams(4));

        // Venue
        addText(formContainer, getString(R.string.exhibitor_field_venue),
                R.color.text_secondary, 13, Typeface.BOLD);
        venueInput = new EditText(this);
        venueInput.setSingleLine(true);
        venueInput.setInputType(InputType.TYPE_CLASS_TEXT);
        venueInput.setHint(R.string.exhibitor_hint_venue);
        if (isEdit) {
            venueInput.setText(existing.getVenue());
        }
        formContainer.addView(venueInput, fullWidthParams(4));

        // Day
        addText(formContainer, getString(R.string.exhibitor_field_day),
                R.color.text_secondary, 13, Typeface.BOLD);
        dayInput = new EditText(this);
        dayInput.setSingleLine(true);
        dayInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        dayInput.setHint(R.string.exhibitor_hint_day);
        if (isEdit) {
            dayInput.setText(String.valueOf(existing.getDay()));
        }
        formContainer.addView(dayInput, fullWidthParams(4));

        // Time
        addText(formContainer, getString(R.string.exhibitor_field_time),
                R.color.text_secondary, 13, Typeface.BOLD);
        timeInput = new EditText(this);
        timeInput.setSingleLine(true);
        timeInput.setInputType(InputType.TYPE_CLASS_TEXT);
        timeInput.setHint(R.string.exhibitor_hint_time);
        if (isEdit) {
            timeInput.setText(existing.getTime());
        }
        formContainer.addView(timeInput, fullWidthParams(4));

        // Category
        addText(formContainer, getString(R.string.exhibitor_field_category),
                R.color.text_secondary, 13, Typeface.BOLD);
        categoryInput = new EditText(this);
        categoryInput.setSingleLine(true);
        categoryInput.setInputType(InputType.TYPE_CLASS_TEXT);
        categoryInput.setHint(R.string.exhibitor_hint_category);
        if (isEdit) {
            categoryInput.setText(existing.getCategory());
        }
        formContainer.addView(categoryInput, fullWidthParams(4));

        // Description
        addText(formContainer, getString(R.string.exhibitor_field_description),
                R.color.text_secondary, 13, Typeface.BOLD);
        descriptionInput = new EditText(this);
        descriptionInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        descriptionInput.setMinLines(2);
        descriptionInput.setHint(R.string.exhibitor_hint_description);
        if (isEdit) {
            descriptionInput.setText(existing.getDescription());
        }
        formContainer.addView(descriptionInput, fullWidthParams(4));

        // Status radio
        addText(formContainer, getString(R.string.exhibitor_field_status),
                R.color.text_secondary, 13, Typeface.BOLD);
        statusGroup = new RadioGroup(this);
        statusGroup.setOrientation(RadioGroup.VERTICAL);
        addStatusOption(ExhibitorExhibition.STATUS_OPEN,
                isEdit && ExhibitorExhibition.STATUS_OPEN.equals(existing.getStatus()));
        addStatusOption(ExhibitorExhibition.STATUS_CLOSED,
                isEdit && ExhibitorExhibition.STATUS_CLOSED.equals(existing.getStatus()));
        addStatusOption(ExhibitorExhibition.STATUS_ENDED,
                isEdit && ExhibitorExhibition.STATUS_ENDED.equals(existing.getStatus()));
        if (!isEdit) {
            // Default to 报名中 for new exhibitions
            ((RadioButton) statusGroup.getChildAt(0)).setChecked(true);
        }
        formContainer.addView(statusGroup, fullWidthParams(4));

        // Save + Cancel buttons
        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);

        Button saveBtn = new Button(this);
        saveBtn.setAllCaps(false);
        saveBtn.setText(R.string.exhibitor_save);
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveExhibition();
            }
        });
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        saveParams.setMargins(0, 0, dp(6), 0);
        buttons.addView(saveBtn, saveParams);

        Button cancelBtn = new Button(this);
        cancelBtn.setAllCaps(false);
        cancelBtn.setText(R.string.exhibitor_cancel);
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editingId = null;
                renderList();
            }
        });
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        cancelParams.setMargins(dp(6), 0, 0, 0);
        buttons.addView(cancelBtn, cancelParams);

        formContainer.addView(buttons, fullWidthParams(12));
    }

    private void addStatusOption(String label, boolean checked) {
        RadioButton rb = new RadioButton(this);
        rb.setId(View.generateViewId());
        rb.setText(label);
        statusGroup.addView(rb, fullWidthParams(0));
        if (checked) {
            statusGroup.check(rb.getId());
        }
    }

    private void saveExhibition() {
        String title = titleInput.getText().toString().trim();
        String venue = venueInput.getText().toString().trim();
        String dayStr = dayInput.getText().toString().trim();
        String time = timeInput.getText().toString().trim();
        String category = categoryInput.getText().toString().trim();
        String description = descriptionInput.getText().toString().trim();

        // Validate required fields
        if (title.length() == 0) {
            titleInput.setError("必填");
            return;
        }
        if (venue.length() == 0) {
            venueInput.setError("必填");
            return;
        }
        if (dayStr.length() == 0) {
            dayInput.setError("必填");
            return;
        }
        if (time.length() == 0) {
            timeInput.setError("必填");
            return;
        }

        int day;
        try {
            day = Integer.parseInt(dayStr);
            if (day < 1 || day > 30) {
                dayInput.setError("1-30");
                return;
            }
        } catch (NumberFormatException e) {
            dayInput.setError("请输入数字");
            return;
        }

        // Get selected status
        int checkedId = statusGroup.getCheckedRadioButtonId();
        RadioButton selectedStatus = findViewById(checkedId);
        String status = selectedStatus != null
                ? selectedStatus.getText().toString()
                : ExhibitorExhibition.STATUS_OPEN;

        if (editingId != null) {
            ExhibitionManager.update(editingId, day, title, venue, time,
                    status, description, category);
        } else {
            ExhibitionManager.add(day, title, venue, time, status, description, category);
        }
        Toast.makeText(this, R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();

        editingId = null;
        renderList();
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
                        editingId = null;
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
        animateHidePanel(formContainer);

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
        closeBtn.setAllCaps(false);
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
