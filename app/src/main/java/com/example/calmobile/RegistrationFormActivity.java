package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

/** 展示展会报名表单，并在本地保存提交结果。 */
public class RegistrationFormActivity extends BaseActivity {

    private LinearLayout regForm;
    private LinearLayout regResult;

    // 页面参数中的展会信息
    private int day;
    private int month;
    private String title;
    private String venue;
    private String time;
    private String status;
    private boolean openForRegistration;
    private String description;
    private String category;

    // 表单控件
    private EditText nameInput;
    private RadioGroup visitorTypeGroup;
    private CheckBox needMeetingCheck;
    private CheckBox needReminderCheck;

    private final RegistrationManager registrationManager = new RegistrationManager();
    private boolean submissionInProgress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canRegisterForExhibitions()) {
            Toast.makeText(this, R.string.auth_login_required_registration,
                    Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        setContentView(R.layout.activity_registration_form);

        regForm = findViewById(R.id.reg_form);
        regResult = findViewById(R.id.reg_result);

        // 读取页面参数
        Intent intent = getIntent();
        day = intent.getIntExtra("day", 1);
        month = intent.getIntExtra("month", 6);
        title = intent.getStringExtra("title");
        venue = intent.getStringExtra("venue");
        time = intent.getStringExtra("time");
        status = intent.getStringExtra("status");
        openForRegistration = intent.getBooleanExtra("openForRegistration", false);
        description = intent.getStringExtra("description");
        category = intent.getStringExtra("category");

        // 返回按钮
        TextView backBtn = findViewById(R.id.reg_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        buildRegistrationForm();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    /** 构建报名表单。 */
    private void buildRegistrationForm() {
        regForm.removeAllViews();

        addText(regForm, getString(R.string.registration_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(regForm, title, R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regForm, getString(R.string.registration_exhibition_meta, month, day, time, venue),
                R.color.text_secondary, 14, Typeface.NORMAL);

        addDivider(regForm);

        // 姓名输入框
        nameInput = new EditText(this);
        nameInput.setSingleLine(true);
        nameInput.setInputType(InputType.TYPE_CLASS_TEXT);
        nameInput.setHint(R.string.registration_name_hint);
        nameInput.setBackgroundResource(R.drawable.bg_input_field);
        nameInput.setPadding(dp(14), dp(14), dp(14), dp(14));
        nameInput.setTextSize(15);
        regForm.addView(nameInput, fullWidthParams(12));

        // 参观身份
        addText(regForm, getString(R.string.registration_visitor_type), R.color.text_primary, 15, Typeface.BOLD);

        visitorTypeGroup = new RadioGroup(this);
        visitorTypeGroup.setOrientation(RadioGroup.VERTICAL);
        addVisitorType(getString(R.string.registration_professional_visitor), true);
        addVisitorType(getString(R.string.registration_procurement_lead), false);
        addVisitorType(getString(R.string.registration_media_partner), false);
        regForm.addView(visitorTypeGroup, fullWidthParams(4));

        // 报名需求
        addText(regForm, getString(R.string.registration_needs), R.color.text_primary, 15, Typeface.BOLD);

        needMeetingCheck = new CheckBox(this);
        needMeetingCheck.setText(R.string.registration_meeting_option);
        regForm.addView(needMeetingCheck, fullWidthParams(4));

        needReminderCheck = new CheckBox(this);
        needReminderCheck.setText(R.string.registration_reminder_option);
        needReminderCheck.setChecked(true);
        regForm.addView(needReminderCheck, fullWidthParams(4));

        addDivider(regForm);

        // 提交按钮
        Button submitButton = new Button(this);
        submitButton.setAllCaps(false);
        submitButton.setText(R.string.submit_registration);
        submitButton.setBackgroundResource(R.drawable.bg_button_primary);
        submitButton.setTextColor(getResources().getColor(R.color.button_primary_text));
        submitButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                submitRegistration();
            }
        });
        regForm.addView(submitButton, fullWidthParams(12));

        addText(regForm, getString(R.string.registration_demo_hint),
                R.color.text_secondary, 14, Typeface.NORMAL);

        animateListItems(regForm, 80);
    }

    /** 向身份选项组添加一个单选项。 */
    private void addVisitorType(String label, boolean checked) {
        RadioButton radioButton = new RadioButton(this);
        radioButton.setId(View.generateViewId());
        radioButton.setText(label);
        visitorTypeGroup.addView(radioButton, fullWidthParams(0));
        if (checked) {
            visitorTypeGroup.check(radioButton.getId());
        }
    }

    /** 校验表单并提交报名。 */
    private void submitRegistration() {
        if (submissionInProgress) {
            return;
        }

        String visitorName = nameInput.getText().toString().trim();
        if (visitorName.length() == 0) {
            nameInput.setError(getString(R.string.registration_name_required));
            nameInput.requestFocus();
            return;
        }
        if (!openForRegistration) {
            Toast.makeText(this, R.string.registration_closed, Toast.LENGTH_SHORT).show();
            return;
        }
        if (registrationManager.hasActiveRegistration(title)) {
            Toast.makeText(this, R.string.registration_already_submitted, Toast.LENGTH_SHORT).show();
            return;
        }

        RadioButton selectedType = findViewById(visitorTypeGroup.getCheckedRadioButtonId());
        if (selectedType == null) {
            return;
        }
        String visitorType = selectedType.getText().toString();
        String meetingNeed = needMeetingCheck.isChecked()
                ? getString(R.string.registration_need_meeting)
                : getString(R.string.registration_visit_only);
        String reminderNeed = needReminderCheck.isChecked()
                ? getString(R.string.registration_reminder_enabled)
                : getString(R.string.registration_reminder_disabled);
        String needsSummary = meetingNeed + "，" + reminderNeed;

        submissionInProgress = true;
        registrationManager.submit(
                title, day, time, venue,
                visitorName, visitorType, needsSummary);
        submissionInProgress = false;

        // 展示提交结果卡片
        regResult.removeAllViews();
        animateShowPanel(regResult);

        addText(regResult, getString(R.string.registration_success_title), R.color.status_open, 18, Typeface.BOLD);
        addDivider(regResult);
        addText(regResult, getString(R.string.registration_exhibition_label, title), R.color.text_primary, 15, Typeface.NORMAL);
        addText(regResult, getString(R.string.registration_time_label, month, day, time),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regResult, getString(R.string.registration_venue_label, venue), R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regResult, getString(R.string.registration_visitor_label, visitorName),
                R.color.text_primary, 15, Typeface.BOLD);
        addText(regResult, getString(R.string.registration_type_label, visitorType),
                R.color.text_primary, 15, Typeface.NORMAL);
        addText(regResult, getString(R.string.registration_needs_label, needsSummary),
                R.color.text_primary, 15, Typeface.NORMAL);

        Toast.makeText(this, R.string.registration_success_message, Toast.LENGTH_SHORT).show();

        // 发送本地通知
        NotificationHelper notificationHelper = NotificationHelper.getInstance(this);
        notificationHelper.sendRegistrationConfirmation(title, visitorName);

        if (needReminderCheck.isChecked()) {
            notificationHelper.sendExhibitionReminder(title, venue, day, time);
        }

        animateListItems(regResult, 80);
    }
}
