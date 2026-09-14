package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** 根据展商配置展示报名信息收集表单。 */
public class RegistrationFormActivity extends BaseActivity {

    private LinearLayout formContainer;
    private LinearLayout resultContainer;
    private String exhibitionId;
    private int day;
    private int month;
    private String title;
    private String venue;
    private String time;
    private boolean openForRegistration;
    private final List<View> answerInputs = new ArrayList<>();
    private final List<RegistrationField> fields = new ArrayList<>();
    private final RegistrationManager registrationManager = new RegistrationManager();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canRegisterForExhibitions()) {
            Toast.makeText(this, R.string.auth_login_required_registration, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        setContentView(R.layout.activity_registration_form);
        formContainer = findViewById(R.id.reg_form);
        resultContainer = findViewById(R.id.reg_result);

        Intent intent = getIntent();
        exhibitionId = intent.getStringExtra(ExhibitionDetailActivity.EXTRA_EXHIBITION_ID);
        day = intent.getIntExtra("day", 1);
        month = intent.getIntExtra("month", 6);
        title = intent.getStringExtra("title");
        venue = intent.getStringExtra("venue");
        time = intent.getStringExtra("time");
        openForRegistration = intent.getBooleanExtra("openForRegistration", false);
        if (exhibitionId != null) {
            fields.addAll(ExhibitionConfiguration.get(exhibitionId).fields);
        }

        TextView backButton = findViewById(R.id.reg_back);
        applyRippleToBackButton(backButton);
        backButton.setOnClickListener(v -> finish());
        buildForm();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    private void buildForm() {
        formContainer.removeAllViews();
        answerInputs.clear();
        addText(formContainer, title, R.color.text_primary, 20, Typeface.BOLD);
        addText(formContainer, getString(R.string.registration_exhibition_meta, month, day, time, venue),
                R.color.text_secondary, 14, Typeface.NORMAL);
        addDivider(formContainer);

        if (fields.isEmpty()) {
            addText(formContainer, "该展会未设置额外报名信息，确认后即可提交。",
                    R.color.text_secondary, 15, Typeface.NORMAL);
        }
        for (RegistrationField field : fields) {
            addText(formContainer, field.getTitle() + (field.isRequired() ? " *" : ""),
                    R.color.text_primary, 15, Typeface.BOLD);
            View input = createInput(field);
            formContainer.addView(input, fullWidthParams(6));
            answerInputs.add(input);
        }

        Button submitButton = new Button(this);
        stylePrimaryButton(submitButton);
        submitButton.setText(R.string.submit_registration);
        submitButton.setOnClickListener(v -> submit());
        formContainer.addView(submitButton, fullWidthParams(12));
        animateListItems(formContainer, 70);
    }

    private View createInput(RegistrationField field) {
        if (RegistrationField.TYPE_SINGLE.equals(field.getType())) {
            RadioGroup group = new RadioGroup(this);
            for (String option : optionsFor(field)) {
                RadioButton button = new RadioButton(this);
                button.setId(View.generateViewId());
                button.setText(option);
                button.setTextColor(getResources().getColor(R.color.text_primary));
                button.setButtonTintList(android.content.res.ColorStateList.valueOf(
                        getResources().getColor(R.color.secondary)));
                group.addView(button, fullWidthParams(0));
            }
            return group;
        }
        if (RegistrationField.TYPE_MULTI.equals(field.getType())) {
            LinearLayout group = new LinearLayout(this);
            group.setOrientation(LinearLayout.VERTICAL);
            for (String option : optionsFor(field)) {
                CheckBox box = new CheckBox(this);
                box.setText(option);
                box.setTextColor(getResources().getColor(R.color.text_primary));
                box.setButtonTintList(android.content.res.ColorStateList.valueOf(
                        getResources().getColor(R.color.secondary)));
                group.addView(box, fullWidthParams(0));
            }
            return group;
        }
        EditText input = new EditText(this);
        styleInputField(input);
        input.setHint("请输入" + field.getTitle());
        input.setMinLines(1);
        return input;
    }

    private List<String> optionsFor(RegistrationField field) {
        List<String> options = new ArrayList<>();
        for (String item : field.getOptions().split(",")) {
            String value = item.trim();
            if (!value.isEmpty()) options.add(value);
        }
        if (options.isEmpty()) options.add("未设置选项");
        return options;
    }

    private void submit() {
        if (!openForRegistration) {
            Toast.makeText(this, R.string.registration_closed, Toast.LENGTH_SHORT).show();
            return;
        }
        if (registrationManager.hasActiveRegistration(title)) {
            Toast.makeText(this, R.string.registration_already_submitted, Toast.LENGTH_SHORT).show();
            return;
        }
        List<String> answers = new ArrayList<>();
        for (int i = 0; i < fields.size(); i++) {
            String answer = readAnswer(answerInputs.get(i));
            if (fields.get(i).isRequired() && answer.isEmpty()) {
                Toast.makeText(this, "请完成：" + fields.get(i).getTitle(), Toast.LENGTH_SHORT).show();
                answerInputs.get(i).requestFocus();
                return;
            }
            answers.add(fields.get(i).getTitle() + "：" + (answer.isEmpty() ? "未填写" : answer));
        }
        String answerText = android.text.TextUtils.join("\n", answers);
        String visitorName = AuthManager.getInstance().getCurrentUsername();
        if (visitorName == null || visitorName.trim().isEmpty()) visitorName = "报名用户";
        registrationManager.submit(title, day, time, venue, visitorName, "自定义报名", answerText);
        RegistrationManagementActivity.addSubmittedRecord(exhibitionId, visitorName, answerText);
        showResult(visitorName, answerText);
    }

    private String readAnswer(View input) {
        if (input instanceof EditText) return ((EditText) input).getText().toString().trim();
        if (input instanceof RadioGroup) {
            RadioButton selected = input.findViewById(((RadioGroup) input).getCheckedRadioButtonId());
            return selected == null ? "" : selected.getText().toString();
        }
        LinearLayout group = (LinearLayout) input;
        List<String> values = new ArrayList<>();
        for (int i = 0; i < group.getChildCount(); i++) {
            CheckBox box = (CheckBox) group.getChildAt(i);
            if (box.isChecked()) values.add(box.getText().toString());
        }
        return android.text.TextUtils.join("、", values);
    }

    private void showResult(String visitorName, String answers) {
        resultContainer.removeAllViews();
        resultContainer.setVisibility(View.VISIBLE);
        addText(resultContainer, getString(R.string.registration_success_title),
                R.color.status_open, 18, Typeface.BOLD);
        addText(resultContainer, "报名人：" + visitorName, R.color.text_primary, 15, Typeface.NORMAL);
        if (!answers.isEmpty()) addText(resultContainer, answers, R.color.text_secondary, 14, Typeface.NORMAL);
        animateShowPanel(resultContainer);
        Toast.makeText(this, R.string.registration_success_message, Toast.LENGTH_SHORT).show();
    }
}
