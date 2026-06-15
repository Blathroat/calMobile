package com.example.calmobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Activity displaying exhibition details received via Intent extras.
 * Shows title, venue, time, status, description, and provides buttons
 * for registration, reminder, and calendar integration.
 */
public class ExhibitionDetailActivity extends BaseActivity {

    private LinearLayout detailContent;
    private LinearLayout detailActions;

    // Exhibition data from Intent
    private int day;
    private String title;
    private String venue;
    private String time;
    private String status;
    private boolean openForRegistration;
    private String description;
    private String category;

    /** Tracks which exhibition is pending calendar permission approval. */
    private boolean pendingCalendarPermission = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_exhibition_detail);

        detailContent = findViewById(R.id.detail_content);
        detailActions = findViewById(R.id.detail_actions);

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
        TextView backBtn = findViewById(R.id.detail_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        buildDetailContent();
        buildActionButtons();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    /**
     * Populate the detail content card with exhibition information.
     */
    private void buildDetailContent() {
        detailContent.removeAllViews();

        addText(detailContent, title, R.color.text_primary, 20, Typeface.BOLD);
        addText(detailContent, category, R.color.text_secondary, 14, Typeface.NORMAL);

        addDivider(detailContent);

        addText(detailContent,
                "时间：6月" + day + "日 " + time,
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailContent,
                "地点：" + venue,
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailContent,
                "状态：" + status,
                openForRegistration ? R.color.status_open : R.color.status_closed,
                15, Typeface.BOLD);

        addDivider(detailContent);

        addText(detailContent, description, R.color.text_primary, 15, Typeface.NORMAL);
        addText(detailContent,
                "说明：当前为本地假数据演示，报名结果不会提交到服务器。",
                R.color.text_secondary, 14, Typeface.NORMAL);
    }

    /**
     * Build the action buttons: register, calendar toggle.
     */
    private void buildActionButtons() {
        detailActions.removeAllViews();

        // Registration button
        Button registerButton = new Button(this);
        registerButton.setAllCaps(false);
        final boolean canRegister = AuthManager.getInstance().canRegisterForExhibitions();
        registerButton.setText(openForRegistration
                ? (canRegister ? R.string.registration_title : R.string.registration_login_required)
                : R.string.registration_closed);
        registerButton.setEnabled(openForRegistration);
        if (openForRegistration) {
            registerButton.setBackgroundResource(R.drawable.bg_button_primary);
            registerButton.setTextColor(getResources().getColor(R.color.button_primary_text));
        } else {
            registerButton.setBackgroundResource(R.drawable.bg_button_secondary);
            registerButton.setTextColor(getResources().getColor(R.color.button_disabled_text));
        }
        registerButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (!AuthManager.getInstance().canRegisterForExhibitions()) {
                    Toast.makeText(ExhibitionDetailActivity.this,
                            R.string.auth_login_required_registration, Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent regIntent = new Intent(ExhibitionDetailActivity.this,
                        RegistrationFormActivity.class);
                regIntent.putExtra("day", day);
                regIntent.putExtra("title", title);
                regIntent.putExtra("venue", venue);
                regIntent.putExtra("time", time);
                regIntent.putExtra("status", status);
                regIntent.putExtra("openForRegistration", openForRegistration);
                regIntent.putExtra("description", description);
                regIntent.putExtra("category", category);
                navigateTo(regIntent);
            }
        });
        detailActions.addView(registerButton, fullWidthParams(0));

        // Calendar toggle button (add/remove)
        final boolean[] isInCalendar = {CalendarHelper.isInCalendar(this, title, day)};
        final Button calendarToggleBtn = new Button(this);
        calendarToggleBtn.setAllCaps(false);
        updateCalendarButton(calendarToggleBtn, isInCalendar[0]);
        calendarToggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (!CalendarHelper.hasCalendarPermissions(ExhibitionDetailActivity.this)) {
                    pendingCalendarPermission = true;
                    CalendarHelper.requestCalendarPermissions(ExhibitionDetailActivity.this);
                    return;
                }
                if (isInCalendar[0]) {
                    CalendarHelper.removeFromCalendar(ExhibitionDetailActivity.this, title, day);
                    isInCalendar[0] = false;
                    Toast.makeText(ExhibitionDetailActivity.this,
                            "已从日历移除", Toast.LENGTH_SHORT).show();
                } else {
                    CalendarHelper.addToCalendar(ExhibitionDetailActivity.this,
                            title, venue, day, time, description);
                    isInCalendar[0] = true;
                    Toast.makeText(ExhibitionDetailActivity.this,
                            "已添加到日历", Toast.LENGTH_SHORT).show();
                }
                updateCalendarButton(calendarToggleBtn, isInCalendar[0]);
            }
        });
        detailActions.addView(calendarToggleBtn, fullWidthParams(8));

        animateListItems(detailActions, 80);
    }
    
    private void updateCalendarButton(Button btn, boolean isInCalendar) {
        if (isInCalendar) {
            btn.setText(R.string.calendar_remove_from_calendar);
            btn.setBackgroundResource(R.drawable.bg_button_danger);
            btn.setTextColor(getResources().getColor(R.color.button_danger_text));
        } else {
            btn.setText(R.string.calendar_add_to_calendar);
            btn.setBackgroundResource(R.drawable.bg_button_secondary);
            btn.setTextColor(getResources().getColor(R.color.button_secondary_text));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
            int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CalendarHelper.REQUEST_CODE_CALENDAR_PERMISSION) {
            if (grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED
                    && grantResults[1] == PackageManager.PERMISSION_GRANTED) {
                if (pendingCalendarPermission) {
                    CalendarHelper.addToCalendar(this,
                            title, venue, day, time, description);
                    pendingCalendarPermission = false;
                }
            } else {
                Toast.makeText(this, R.string.calendar_permission_denied,
                        Toast.LENGTH_SHORT).show();
                pendingCalendarPermission = false;
            }
        }
    }
}
