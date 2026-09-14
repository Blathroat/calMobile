package com.example.calmobile;

import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;

/** 展商创建和编辑展会，配置排期、简介与报名收集项。 */
public class ExhibitionFormActivity extends BaseActivity {
    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";
    private static final int REQUEST_DESCRIPTION = 3101;

    private LinearLayout formContainer;
    private LinearLayout fieldsContainer;
    private EditText titleInput;
    private EditText venueInput;
    private TextView exhibitionDatePicker;
    private TextView registrationStartPicker;
    private TextView registrationEndPicker;
    private TextView startTimePicker;
    private TextView endTimePicker;
    private TextView descriptionPreview;
    private Spinner categorySpinner;
    private RadioGroup statusGroup;
    private String editingId;
    private String descriptionHtml = "";
    private String descriptionImageUri = "";
    private final List<LinearLayout> fieldRows = new ArrayList<>();

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
        editingId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID);
        ExhibitorExhibition exhibition = editingId == null ? null : ExhibitionManager.findById(editingId);
        if (editingId != null && exhibition == null) {
            Toast.makeText(this, R.string.exhibition_form_not_found, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        TextView back = findViewById(R.id.exhibition_form_back);
        applyRippleToBackButton(back);
        back.setOnClickListener(v -> finish());
        buildForm(exhibition);
    }

    private void buildForm(ExhibitorExhibition exhibition) {
        formContainer.removeAllViews();
        ((TextView) findViewById(R.id.exhibition_form_title)).setText(
                exhibition == null ? R.string.exhibitor_add_exhibition : R.string.exhibitor_edit_exhibition);
        ExhibitionConfiguration.Data configuration = exhibition == null
                ? null : ExhibitionConfiguration.get(exhibition.getId());
        descriptionHtml = exhibition == null ? "" : exhibition.getDescription();
        descriptionImageUri = configuration == null ? "" : configuration.imageUri;

        titleInput = addTextField("展会名称", exhibition == null ? "" : exhibition.getTitle(), "请输入展会名称");
        venueInput = addTextField("展馆地点", exhibition == null ? "" : exhibition.getVenue(), "请输入展馆地点");

        String existingDate = configuration == null ? "" : configuration.exhibitionDate;
        if (exhibition != null && (existingDate.isEmpty() || "2026-06-01".equals(existingDate))) {
            existingDate = String.format(Locale.CHINA, "2026-06-%02d", exhibition.getDay());
        }
        addLabel("开展日期");
        exhibitionDatePicker = addDatePicker(existingDate, "选择开展日期");

        addLabel("报名时间");
        LinearLayout registrationRow = new LinearLayout(this);
        registrationRow.setOrientation(LinearLayout.HORIZONTAL);
        registrationStartPicker = createPicker("开始日期", configuration == null ? "" : configuration.registrationStart);
        registrationEndPicker = createPicker("截止日期", configuration == null ? "" : configuration.registrationEnd);
        registrationStartPicker.setOnClickListener(v -> chooseDate(registrationStartPicker));
        registrationEndPicker.setOnClickListener(v -> chooseDate(registrationEndPicker));
        registrationRow.addView(registrationStartPicker, halfWidthParams(0, 6));
        registrationRow.addView(registrationEndPicker, halfWidthParams(6, 0));
        formContainer.addView(registrationRow, fullWidthParams(4));

        addLabel("开展时间");
        LinearLayout timeRow = new LinearLayout(this);
        timeRow.setOrientation(LinearLayout.HORIZONTAL);
        String[] existingTimes = exhibition == null ? new String[0] : exhibition.getTime().split("-");
        startTimePicker = createPicker("开始时间", existingTimes.length > 0 ? existingTimes[0] : "");
        endTimePicker = createPicker("结束时间", existingTimes.length > 1 ? existingTimes[1] : "");
        startTimePicker.setOnClickListener(v -> chooseTime(startTimePicker));
        endTimePicker.setOnClickListener(v -> chooseTime(endTimePicker));
        timeRow.addView(startTimePicker, halfWidthParams(0, 6));
        timeRow.addView(endTimePicker, halfWidthParams(6, 0));
        formContainer.addView(timeRow, fullWidthParams(4));

        addLabel("展会分类");
        categorySpinner = new Spinner(this);
        List<String> categories = AppSettings.getCategories(this);
        categorySpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, categories));
        categorySpinner.setBackgroundResource(R.drawable.bg_picker_field);
        categorySpinner.setPadding(dp(10), 0, dp(10), 0);
        categorySpinner.setMinimumHeight(dp(48));
        if (exhibition != null) categorySpinner.setSelection(Math.max(0, categories.indexOf(exhibition.getCategory())));
        formContainer.addView(categorySpinner, fullWidthParams(5));

        addLabel("展会简介");
        descriptionPreview = new TextView(this);
        descriptionPreview.setTextColor(getResources().getColor(R.color.text_secondary));
        descriptionPreview.setTextSize(15);
        descriptionPreview.setGravity(Gravity.CENTER_VERTICAL);
        descriptionPreview.setMinHeight(dp(72));
        descriptionPreview.setBackgroundResource(R.drawable.bg_picker_field);
        descriptionPreview.setPadding(dp(14), dp(12), dp(14), dp(12));
        descriptionPreview.setOnClickListener(v -> openDescriptionEditor());
        formContainer.addView(descriptionPreview, fullWidthParams(0));
        Button editDescription = new Button(this);
        styleSecondaryButton(editDescription);
        editDescription.setText("编辑展会简介");
        editDescription.setOnClickListener(v -> openDescriptionEditor());
        formContainer.addView(editDescription, fullWidthParams(6));
        updateDescriptionPreview();

        addLabel("报名信息收集项");
        fieldsContainer = new LinearLayout(this);
        fieldsContainer.setOrientation(LinearLayout.VERTICAL);
        formContainer.addView(fieldsContainer, fullWidthParams(2));
        if (configuration != null && !configuration.fields.isEmpty()) {
            for (RegistrationField field : configuration.fields) addFieldRow(field);
        } else {
            addFieldRow(null);
        }
        Button addField = new Button(this);
        styleSecondaryButton(addField);
        addField.setText("新增收集项");
        addField.setOnClickListener(v -> addFieldRow(null));
        formContainer.addView(addField, fullWidthParams(5));

        addLabel("展会状态");
        statusGroup = new RadioGroup(this);
        addStatus(ExhibitorExhibition.STATUS_OPEN,
                exhibition == null || ExhibitorExhibition.STATUS_OPEN.equals(exhibition.getStatus()));
        addStatus(ExhibitorExhibition.STATUS_CLOSED,
                exhibition != null && ExhibitorExhibition.STATUS_CLOSED.equals(exhibition.getStatus()));
        formContainer.addView(statusGroup, fullWidthParams(5));

        Button save = new Button(this);
        stylePrimaryButton(save);
        save.setText("保存展会");
        save.setOnClickListener(v -> saveExhibition());
        formContainer.addView(save, fullWidthParams(12));
        animateListItems(formContainer, 50);
    }

    private EditText addTextField(String label, String value, String hint) {
        addLabel(label);
        EditText input = new EditText(this);
        styleInputField(input);
        input.setText(value);
        input.setHint(hint);
        formContainer.addView(input, fullWidthParams(4));
        return input;
    }

    private TextView addDatePicker(String value, String label) {
        TextView picker = createPicker(label, value);
        picker.setOnClickListener(v -> chooseDate(picker));
        formContainer.addView(picker, fullWidthParams(4));
        return picker;
    }

    private TextView createPicker(String label, String value) {
        TextView picker = new TextView(this);
        stylePickerField(picker);
        picker.setTextColor(getResources().getColor(value.isEmpty() ? R.color.text_hint : R.color.text_primary));
        picker.setTextSize(15);
        picker.setTag(label);
        picker.setText(value.isEmpty() ? label : value);
        return picker;
    }

    private LinearLayout.LayoutParams halfWidthParams(int leftMargin, int rightMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        params.setMargins(dp(leftMargin), 0, dp(rightMargin), 0);
        return params;
    }

    private void chooseDate(TextView target) {
        Calendar calendar = Calendar.getInstance();
        new DatePickerDialog(this, (view, year, month, day) -> setPickerValue(target,
                String.format(Locale.CHINA, "%04d-%02d-%02d", year, month + 1, day)),
                calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private void chooseTime(TextView target) {
        Calendar calendar = Calendar.getInstance();
        new TimePickerDialog(this, (view, hour, minute) -> setPickerValue(target,
                String.format(Locale.CHINA, "%02d:%02d", hour, minute)),
                calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show();
    }

    private void setPickerValue(TextView picker, String value) {
        picker.setText(value);
        picker.setTextColor(getResources().getColor(R.color.text_primary));
    }

    private boolean hasPickerValue(TextView picker) {
        return !picker.getText().toString().equals(picker.getTag());
    }

    private void addLabel(String label) {
        addText(formContainer, label, R.color.text_secondary, 13, android.graphics.Typeface.BOLD);
    }

    private void openDescriptionEditor() {
        Intent intent = new Intent(this, RichDescriptionEditorActivity.class);
        intent.putExtra(RichDescriptionEditorActivity.EXTRA_HTML, descriptionHtml);
        intent.putExtra(RichDescriptionEditorActivity.EXTRA_IMAGE_URI, descriptionImageUri);
        startActivityForResult(intent, REQUEST_DESCRIPTION);
    }

    private void updateDescriptionPreview() {
        String plainText = android.text.Html.fromHtml(descriptionHtml == null ? "" : descriptionHtml,
                android.text.Html.FROM_HTML_MODE_LEGACY).toString().trim();
        if (plainText.isEmpty()) {
            descriptionPreview.setText("点击编辑简介，可插入图片与丰富排版");
            descriptionPreview.setTextColor(getResources().getColor(R.color.text_hint));
        } else {
            descriptionPreview.setText(plainText);
            descriptionPreview.setTextColor(getResources().getColor(R.color.text_primary));
        }
    }

    private void addStatus(String value, boolean checked) {
        RadioButton button = new RadioButton(this);
        button.setId(View.generateViewId());
        button.setText(value);
        button.setTag(value);
        statusGroup.addView(button);
        if (checked) statusGroup.check(button.getId());
    }

    private void addFieldRow(RegistrationField field) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(12), dp(8), dp(12), dp(8));
        row.setBackgroundResource(R.drawable.bg_picker_field);
        EditText fieldTitle = new EditText(this);
        styleInputField(fieldTitle);
        fieldTitle.setHint("条目标题");
        if (field != null) fieldTitle.setText(field.getTitle());
        Spinner type = new Spinner(this);
        String[] types = {RegistrationField.TYPE_TEXT, RegistrationField.TYPE_SINGLE, RegistrationField.TYPE_MULTI};
        type.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, types));
        if (field != null) type.setSelection(Math.max(0, Arrays.asList(types).indexOf(field.getType())));
        CheckBox required = new CheckBox(this);
        required.setText("必填");
        if (field != null) required.setChecked(field.isRequired());
        EditText options = new EditText(this);
        styleInputField(options);
        options.setHint("单选或多选时，用逗号分隔选项");
        if (field != null) options.setText(field.getOptions());
        Button remove = new Button(this);
        styleSecondaryButton(remove);
        remove.setText("删除此项");
        remove.setOnClickListener(v -> { fieldsContainer.removeView(row); fieldRows.remove(row); });
        row.addView(fieldTitle); row.addView(type); row.addView(required); row.addView(options); row.addView(remove);
        fieldsContainer.addView(row, fullWidthParams(6));
        fieldRows.add(row);
    }

    private void saveExhibition() {
        if (titleInput.getText().toString().trim().isEmpty() || venueInput.getText().toString().trim().isEmpty()
                || !hasPickerValue(exhibitionDatePicker) || !hasPickerValue(startTimePicker) || !hasPickerValue(endTimePicker)) {
            Toast.makeText(this, "请完成展会名称、地点、日期和开展时间", Toast.LENGTH_SHORT).show();
            return;
        }
        String exhibitionDate = exhibitionDatePicker.getText().toString();
        String registrationStart = hasPickerValue(registrationStartPicker)
                ? registrationStartPicker.getText().toString() : "";
        String registrationEnd = hasPickerValue(registrationEndPicker)
                ? registrationEndPicker.getText().toString() : "";
        if (registrationStart.isEmpty() != registrationEnd.isEmpty()) {
            Toast.makeText(this, "请同时选择报名开始和截止日期", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!registrationStart.isEmpty() && compareDate(registrationStart, registrationEnd) > 0) {
            Toast.makeText(this, "报名开始日期不能晚于截止日期", Toast.LENGTH_SHORT).show();
            return;
        }
        if (compareTime(startTimePicker.getText().toString(), endTimePicker.getText().toString()) > 0) {
            Toast.makeText(this, "开展开始时间不能晚于结束时间", Toast.LENGTH_SHORT).show();
            return;
        }
        int day = Integer.parseInt(exhibitionDate.substring(8));
        RadioButton selected = findViewById(statusGroup.getCheckedRadioButtonId());
        String state = selected == null ? ExhibitorExhibition.STATUS_OPEN : selected.getTag().toString();
        String time = startTimePicker.getText().toString() + "-" + endTimePicker.getText().toString();
        if (editingId == null) {
            ExhibitorExhibition created = ExhibitionManager.add(day, titleInput.getText().toString().trim(),
                    venueInput.getText().toString().trim(), time, state, descriptionHtml,
                    categorySpinner.getSelectedItem().toString());
            editingId = created.getId();
        } else {
            ExhibitionManager.update(editingId, day, titleInput.getText().toString().trim(),
                    venueInput.getText().toString().trim(), time, state, descriptionHtml,
                    categorySpinner.getSelectedItem().toString());
        }
        List<RegistrationField> fields = new ArrayList<>();
        for (LinearLayout row : fieldRows) {
            String label = ((EditText) row.getChildAt(0)).getText().toString().trim();
            if (!label.isEmpty()) fields.add(new RegistrationField(label,
                    ((Spinner) row.getChildAt(1)).getSelectedItem().toString(),
                    ((CheckBox) row.getChildAt(2)).isChecked(), ((EditText) row.getChildAt(3)).getText().toString()));
        }
        ExhibitionConfiguration.save(editingId, exhibitionDate, registrationStart, registrationEnd,
                descriptionImageUri, fields);
        Toast.makeText(this, R.string.exhibitor_saved, Toast.LENGTH_SHORT).show();
        setResult(RESULT_OK);
        finish();
    }

    private int compareDate(String left, String right) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
            format.setLenient(false);
            Date leftDate = format.parse(left);
            Date rightDate = format.parse(right);
            return leftDate.compareTo(rightDate);
        } catch (ParseException exception) {
            return 0;
        }
    }

    private int compareTime(String left, String right) {
        return left.compareTo(right);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_DESCRIPTION || resultCode != RESULT_OK || data == null) return;
        descriptionHtml = data.getStringExtra(RichDescriptionEditorActivity.EXTRA_HTML);
        descriptionImageUri = data.getStringExtra(RichDescriptionEditorActivity.EXTRA_IMAGE_URI);
        if (descriptionHtml == null) descriptionHtml = "";
        if (descriptionImageUri == null) descriptionImageUri = "";
        updateDescriptionPreview();
    }
}
