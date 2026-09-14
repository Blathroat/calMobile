package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 普通用户查看自己的报名信息和当前状态。 */
public class MyRegistrationDetailActivity extends BaseActivity {
    public static final String EXTRA_REGISTRATION_ID = "registration_id";
    private final RegistrationManager registrationManager = new RegistrationManager();
    private String registrationId;
    private LinearLayout content;
    private LinearLayout actions;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!AuthManager.getInstance().canAccessProfile()) {
            finish();
            return;
        }
        setContentView(R.layout.activity_my_registration_detail);
        registrationId = getIntent().getStringExtra(EXTRA_REGISTRATION_ID);
        content = findViewById(R.id.my_registration_detail_content);
        actions = findViewById(R.id.my_registration_detail_actions);
        TextView back = findViewById(R.id.my_registration_detail_back);
        applyRippleToBackButton(back);
        back.setOnClickListener(v -> finish());
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (content != null) render();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    private void render() {
        Registration registration = findRegistration();
        if (registration == null) {
            finish();
            return;
        }
        content.removeAllViews();
        actions.removeAllViews();
        addText(content, "报名详情", R.color.text_primary, 20, Typeface.BOLD);
        addText(content, registration.getExhibitionTitle(), R.color.text_primary, 17, Typeface.BOLD);
        addDetail("时间", registration.getExhibitionDay() + "日 " + registration.getExhibitionTime());
        addDetail("地点", registration.getExhibitionVenue());
        addDetail("报名信息", registration.getNeedsSummary().isEmpty()
                ? "未填写额外信息" : registration.getNeedsSummary());
        boolean cancelled = registration.getStatus() == Registration.Status.CANCELLED;
        addDetail("当前状态", cancelled ? getString(R.string.status_cancelled)
                : getString(R.string.status_pending));
        if (!cancelled) {
            Button cancel = new Button(this);
            styleDangerButton(cancel);
            cancel.setText(R.string.cancel_registration);
            cancel.setOnClickListener(v -> showConfirmDialog(
                    getString(R.string.confirm_cancel_registration), () -> {
                        registrationManager.cancel(registration.getId());
                        Toast.makeText(this, R.string.registration_cancelled,
                                Toast.LENGTH_SHORT).show();
                        render();
                    }));
            actions.addView(cancel, fullWidthParams(0));
        }
    }

    private Registration findRegistration() {
        for (Registration registration : registrationManager.list()) {
            if (registration.getId().equals(registrationId)) return registration;
        }
        return null;
    }

    private void addDetail(String label, String value) {
        addText(content, label, R.color.text_secondary, 13, Typeface.BOLD);
        addText(content, value, R.color.text_primary, 15, Typeface.NORMAL);
    }
}
