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

/**
 * Activity displaying the exhibition registration form.
 * Receives exhibition data via Intent extras and handles
 * registration submission with local feedback.
 */
public class RegistrationFormActivity extends BaseActivity {

    private LinearLayout regForm;
    private LinearLayout regResult;

    // Exhibition data from Intent
    private int day;
    private String title;
    private String venue;
    private String time;
    private String status;
    private boolean openForRegistration;
    private String description;
    private String category;

    // Form fields
    private EditText nameInput;
    private RadioGroup visitorTypeGroup;
    private CheckBox needMeetingCheck;
    private CheckBox needReminderCheck;

    private final RegistrationManager registrationManager = new RegistrationManager();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_registration_form);

        regForm = findViewById(R.id.reg_form);
        regResult = findViewById(R.id.reg_result);

        // Read exhibition data from Intent extras
        Intent intent = getIntent();
        day = intent.getIntExtra("day", 1);
        title = intent.getStringExtra("title");
        venue = intent.getStringExtra("venue");
        time = intent.getStringExtra("time");
        status = intent.getStringExtra("status");
        openForRegistration = intent.getBooleanExtra("openForRegistration", false);
        description = intent.getStringExtra("description");
        category = intent.getStringExtra("category");

        // Back button
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

    /**
     * Build the registration form with all fields.
     */
    private void buildRegistrationForm() {
        regForm.removeAllViews();

        addText(regForm, getString(R.string.registration_title),
                R.color.text_primary, 20, Typeface.BOLD);
        addText(regForm, title, R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regForm, "6月" + day + "日 " + time + " · " + venue,
                R.color.text_secondary, 14, Typeface.NORMAL);

        addDivider(regForm);

        // Name input
        nameInput = new EditText(this);
        nameInput.setSingleLine(true);
        nameInput.setInputType(InputType.TYPE_CLASS_TEXT);
        nameInput.setHint("姓名 / 公司名称");
        nameInput.setBackgroundResource(R.drawable.bg_input_field);
        nameInput.setPadding(dp(14), dp(14), dp(14), dp(14));
        nameInput.setTextSize(15);
        regForm.addView(nameInput, fullWidthParams(12));

        // Visitor type section
        addText(regForm, "参观身份", R.color.text_primary, 15, Typeface.BOLD);

        visitorTypeGroup = new RadioGroup(this);
        visitorTypeGroup.setOrientation(RadioGroup.VERTICAL);
        addVisitorType("专业观众", true);
        addVisitorType("采购负责人", false);
        addVisitorType("媒体或合作伙伴", false);
        regForm.addView(visitorTypeGroup, fullWidthParams(4));

        // Requirements section
        addText(regForm, "报名需求", R.color.text_primary, 15, Typeface.BOLD);

        needMeetingCheck = new CheckBox(this);
        needMeetingCheck.setText("希望安排展商洽谈");
        regForm.addView(needMeetingCheck, fullWidthParams(4));

        needReminderCheck = new CheckBox(this);
        needReminderCheck.setText("需要开展前提醒");
        needReminderCheck.setChecked(true);
        regForm.addView(needReminderCheck, fullWidthParams(4));

        addDivider(regForm);

        // Submit button
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

        addText(regForm, "填写后点击提交，页面会生成本地演示反馈。",
                R.color.text_secondary, 14, Typeface.NORMAL);

        animateListItems(regForm, 80);
    }

    /**
     * Add a visitor type radio button to the group.
     */
    private void addVisitorType(String label, boolean checked) {
        RadioButton radioButton = new RadioButton(this);
        radioButton.setId(View.generateViewId());
        radioButton.setText(label);
        visitorTypeGroup.addView(radioButton, fullWidthParams(0));
        if (checked) {
            visitorTypeGroup.check(radioButton.getId());
        }
    }

    /**
     * Handle registration submission.
     */
    private void submitRegistration() {
        String visitorName = nameInput.getText().toString().trim();
        if (visitorName.length() == 0) {
            visitorName = "匿名观众";
        }

        RadioButton selectedType = findViewById(visitorTypeGroup.getCheckedRadioButtonId());
        String visitorType = selectedType.getText().toString();
        String meetingNeed = needMeetingCheck.isChecked() ? "需要洽谈" : "仅参观";
        String reminderNeed = needReminderCheck.isChecked() ? "已勾选提醒" : "不提醒";
        String needsSummary = meetingNeed + "，" + reminderNeed;

        registrationManager.submit(
                title, day, time, venue,
                visitorName, visitorType, needsSummary);

        // Show result card
        regResult.removeAllViews();
        animateShowPanel(regResult);

        addText(regResult, "报名已提交", R.color.status_open, 18, Typeface.BOLD);
        addDivider(regResult);
        addText(regResult, "展会：" + title, R.color.text_primary, 15, Typeface.NORMAL);
        addText(regResult, "时间：6月" + day + "日 " + time,
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regResult, "地点：" + venue, R.color.text_secondary, 15, Typeface.NORMAL);
        addText(regResult, "报名人：" + visitorName,
                R.color.text_primary, 15, Typeface.BOLD);
        addText(regResult, "身份：" + visitorType,
                R.color.text_primary, 15, Typeface.NORMAL);
        addText(regResult, "需求：" + needsSummary,
                R.color.text_primary, 15, Typeface.NORMAL);

        Toast.makeText(this, "报名已提交", Toast.LENGTH_SHORT).show();

        // Send notifications
        NotificationHelper notificationHelper = NotificationHelper.getInstance(this);
        notificationHelper.sendRegistrationConfirmation(title, visitorName);

        if (needReminderCheck.isChecked()) {
            notificationHelper.sendExhibitionReminder(title, venue, day, time);
        }

        animateListItems(regResult, 80);
    }
}
