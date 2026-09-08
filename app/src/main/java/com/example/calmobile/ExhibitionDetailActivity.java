package com.example.calmobile;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.Html;
import android.widget.ImageView;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 接收页面参数并展示展会详情，提供报名和系统日历操作。 */
public class ExhibitionDetailActivity extends BaseActivity {

    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";

    private LinearLayout detailContent;
    private LinearLayout detailActions;

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
    private String exhibitionId;

    /** 标记正在等待日历权限的展会操作。 */
    private boolean pendingCalendarPermission = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_exhibition_detail);

        detailContent = findViewById(R.id.detail_content);
        detailActions = findViewById(R.id.detail_actions);

        // 读取页面参数
        Intent intent = getIntent();
        day = intent.getIntExtra("day", 1);
        month = intent.getIntExtra("month", 6);
        exhibitionId = intent.getStringExtra(EXTRA_EXHIBITION_ID);
        title = intent.getStringExtra("title");
        venue = intent.getStringExtra("venue");
        time = intent.getStringExtra("time");
        status = intent.getStringExtra("status");
        openForRegistration = intent.getBooleanExtra("openForRegistration", false);
        description = intent.getStringExtra("description");
        category = intent.getStringExtra("category");

        // 返回按钮
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

    /** 填充展会详情卡片。 */
    private void buildDetailContent() {
        detailContent.removeAllViews();

        addText(detailContent, title, R.color.text_primary, 20, Typeface.BOLD);
        addText(detailContent, category, R.color.text_secondary, 14, Typeface.NORMAL);

        addDivider(detailContent);

        addText(detailContent,
                getString(R.string.detail_time, month, day, time),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailContent,
                getString(R.string.detail_venue, venue),
                R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailContent,
                getString(R.string.detail_status, status),
                openForRegistration ? R.color.status_open : R.color.status_closed,
                15, Typeface.BOLD);

        addDivider(detailContent);

        TextView descriptionView = new TextView(this);
        descriptionView.setText(Html.fromHtml(description == null ? "" : description, Html.FROM_HTML_MODE_LEGACY));
        descriptionView.setTextColor(getResources().getColor(R.color.text_primary));
        descriptionView.setTextSize(15);
        descriptionView.setLineSpacing(0, 1.25f);
        detailContent.addView(descriptionView, fullWidthParams(4));
        if (exhibitionId != null) {
            String imageUri = ExhibitionConfiguration.get(exhibitionId).imageUri;
            if (imageUri != null && !imageUri.isEmpty()) {
                ImageView image = new ImageView(this);
                image.setAdjustViewBounds(true);
                image.setImageURI(android.net.Uri.parse(imageUri));
                detailContent.addView(image, fullWidthParams(6));
            }
        }
        addText(detailContent,
                getString(R.string.detail_local_demo_note),
                R.color.text_secondary, 14, Typeface.NORMAL);
    }

    /** 构建报名与日历操作按钮。 */
    private void buildActionButtons() {
        detailActions.removeAllViews();

        // 管理页详情提供与展商后台一致的编辑和报名入口。
        if (exhibitionId != null && AuthManager.getInstance().canAccessExhibitor()) {
            LinearLayout manageRow = new LinearLayout(this);
            manageRow.setOrientation(LinearLayout.HORIZONTAL);

            Button editButton = new Button(this);
            styleSecondaryButton(editButton);
            editButton.setText(R.string.exhibitor_edit_exhibition);
            editButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Intent editIntent = new Intent(ExhibitionDetailActivity.this,
                            ExhibitionFormActivity.class);
                    editIntent.putExtra(ExhibitionFormActivity.EXTRA_EXHIBITION_ID, exhibitionId);
                    navigateTo(editIntent);
                }
            });
            LinearLayout.LayoutParams editParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            editParams.setMargins(0, 0, dp(4), 0);
            manageRow.addView(editButton, editParams);

            Button registrationsButton = new Button(this);
            styleSecondaryButton(registrationsButton);
            registrationsButton.setText(R.string.reg_mgmt_nav_btn);
            registrationsButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Intent registrationsIntent = new Intent(ExhibitionDetailActivity.this,
                            RegistrationManagementActivity.class);
                    registrationsIntent.putExtra(RegistrationManagementActivity.EXTRA_EXHIBITION_ID,
                            exhibitionId);
                    navigateTo(registrationsIntent);
                }
            });
            LinearLayout.LayoutParams registrationsParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            registrationsParams.setMargins(dp(4), 0, 0, 0);
            manageRow.addView(registrationsButton, registrationsParams);
            detailActions.addView(manageRow, fullWidthParams(0));
        }

        // 报名按钮
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
                regIntent.putExtra("month", month);
                regIntent.putExtra("title", title);
                regIntent.putExtra("venue", venue);
                regIntent.putExtra("time", time);
                regIntent.putExtra("status", status);
                regIntent.putExtra("openForRegistration", openForRegistration);
                regIntent.putExtra("description", description);
                regIntent.putExtra("category", category);
                regIntent.putExtra(EXTRA_EXHIBITION_ID, exhibitionId);
                navigateTo(regIntent);
            }
        });
        detailActions.addView(registerButton, fullWidthParams(0));

        TextView registrationHint = new TextView(this);
        registrationHint.setText(openForRegistration
                ? (canRegister ? R.string.registration_local_demo_hint
                        : R.string.auth_login_required_registration)
                : R.string.registration_closed);
        registrationHint.setTextAppearance(this, R.style.TextAppearance_Caption);
        detailActions.addView(registrationHint, fullWidthParams(6));

        // 系统日历添加或移除按钮
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
                            R.string.calendar_removed_feedback, Toast.LENGTH_SHORT).show();
                } else {
                    CalendarHelper.addToCalendar(ExhibitionDetailActivity.this,
                            title, venue, day, time, description);
                    isInCalendar[0] = true;
                    Toast.makeText(ExhibitionDetailActivity.this,
                            R.string.calendar_added_feedback, Toast.LENGTH_SHORT).show();
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
