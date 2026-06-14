package com.example.calmobile;

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

/**
 * Dedicated exhibitor form Activity for creating and editing exhibitions.
 */
public class ExhibitionFormActivity extends BaseActivity {

    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";

    private LinearLayout formContainer;
    private TextView titleView;

    private EditText titleInput;
    private EditText venueInput;
    private EditText dayInput;
    private EditText timeInput;
    private EditText categoryInput;
    private EditText descriptionInput;
    private RadioGroup statusGroup;

    private String editingId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canAccessExhibitor()) {
            Toast.makeText(this, R.string.auth_exhibitor_required, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        setContentView(R.layout.activity_exhibition_form);

        formContainer = findViewById(R.id.exhibition_form);
        titleView = findViewById(R.id.exhibition_form_title);

        ExhibitionManager.ensureInitialized();

        editingId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID);
        ExhibitorExhibition existing = null;
        if (editingId != null) {
            existing = ExhibitionManager.findById(editingId);
            if (existing == null) {
                Toast.makeText(this, R.string.exhibition_form_not_found,
                        Toast.LENGTH_SHORT).show();
                setResult(RESULT_CANCELED);
                finish();
                return;
            }
        }

        TextView backBtn = findViewById(R.id.exhibition_form_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                setResult(RESULT_CANCELED);
                finish();
            }
        });

        buildForm(existing);
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    private void buildForm(ExhibitorExhibition existing) {
        formContainer.removeAllViews();

        boolean isEdit = existing != null;
        titleView.setText(isEdit
                ? R.string.exhibitor_edit_exhibition
                : R.string.exhibitor_add_exhibition);

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

        addText(formContainer, getString(R.string.exhibitor_field_status),
                R.color.text_secondary, 13, Typeface.BOLD);
        statusGroup = new RadioGroup(this);
        statusGroup.setOrientation(RadioGroup.VERTICAL);
        addStatusOption(ExhibitorExhibition.STATUS_OPEN, R.string.exhibitor_status_open,
                !isEdit || ExhibitorExhibition.STATUS_OPEN.equals(existing.getStatus()));
        addStatusOption(ExhibitorExhibition.STATUS_CLOSED, R.string.exhibitor_status_closed,
                isEdit && ExhibitorExhibition.STATUS_CLOSED.equals(existing.getStatus()));
        addStatusOption(ExhibitorExhibition.STATUS_ENDED, R.string.exhibitor_status_ended,
                isEdit && ExhibitorExhibition.STATUS_ENDED.equals(existing.getStatus()));
        formContainer.addView(statusGroup, fullWidthParams(4));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);

        Button saveBtn = new Button(this);
        stylePrimaryButton(saveBtn);
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
        styleSecondaryButton(cancelBtn);
        cancelBtn.setText(R.string.exhibitor_cancel);
        cancelBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                setResult(RESULT_CANCELED);
                finish();
            }
        });
        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        cancelParams.setMargins(dp(6), 0, 0, 0);
        buttons.addView(cancelBtn, cancelParams);

        formContainer.addView(buttons, fullWidthParams(12));
        animateListItems(formContainer, 80);
    }

    private void addStatusOption(String statusValue, int labelRes, boolean checked) {
        RadioButton radioButton = new RadioButton(this);
        radioButton.setId(View.generateViewId());
        radioButton.setText(labelRes);
        radioButton.setTag(statusValue);
        statusGroup.addView(radioButton, fullWidthParams(0));
        if (checked) {
            statusGroup.check(radioButton.getId());
        }
    }

    private void saveExhibition() {
        String title = titleInput.getText().toString().trim();
        String venue = venueInput.getText().toString().trim();
        String dayStr = dayInput.getText().toString().trim();
        String time = timeInput.getText().toString().trim();
        String category = categoryInput.getText().toString().trim();
        String description = descriptionInput.getText().toString().trim();

        if (title.length() == 0) {
            titleInput.setError(getString(R.string.exhibitor_validation_required));
            return;
        }
        if (venue.length() == 0) {
            venueInput.setError(getString(R.string.exhibitor_validation_required));
            return;
        }
        if (dayStr.length() == 0) {
            dayInput.setError(getString(R.string.exhibitor_validation_required));
            return;
        }
        if (time.length() == 0) {
            timeInput.setError(getString(R.string.exhibitor_validation_required));
            return;
        }

        int day;
        try {
            day = Integer.parseInt(dayStr);
            if (day < 1 || day > 30) {
                dayInput.setError(getString(R.string.exhibitor_validation_day_range));
                return;
            }
        } catch (NumberFormatException e) {
            dayInput.setError(getString(R.string.exhibitor_validation_day_number));
            return;
        }

        RadioButton selectedStatus = findViewById(statusGroup.getCheckedRadioButtonId());
        String status = selectedStatus != null && selectedStatus.getTag() != null
                ? selectedStatus.getTag().toString()
                : ExhibitorExhibition.STATUS_OPEN;

        if (editingId != null) {
            ExhibitionManager.update(editingId, day, title, venue, time,
                    status, description, category);
        } else {
            ExhibitionManager.add(day, title, venue, time, status, description, category);
        }

        Toast.makeText(this, R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();
        setResult(RESULT_OK, new Intent());
        finish();
    }
}
