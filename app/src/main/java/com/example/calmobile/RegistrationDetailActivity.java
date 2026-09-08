package com.example.calmobile;

import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 展示一位报名人的完整资料，并执行审批操作。 */
public class RegistrationDetailActivity extends BaseActivity {
    public static final String EXTRA_RECORD_ID = "record_id";
    private String recordId;
    private LinearLayout content;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!AuthManager.getInstance().canAccessExhibitor()) { finish(); return; }
        setContentView(R.layout.activity_registration_detail);
        recordId = getIntent().getStringExtra(EXTRA_RECORD_ID);
        content = findViewById(R.id.registration_detail_content);
        TextView back = findViewById(R.id.registration_detail_back);
        applyRippleToBackButton(back); back.setOnClickListener(v -> finish());
        render();
    }
    private void render() {
        content.removeAllViews();
        RegistrationManagementActivity.MgmtRecord record = RegistrationManagementActivity.findRecord(recordId);
        if (record == null) { finish(); return; }
        addText(content, record.visitorName, R.color.text_primary, 21, Typeface.BOLD);
        addDetail("报名时间", record.registrationTime);
        addDetail("审核状态", record.status);
        addDetail("报名信息", record.formAnswers.isEmpty() ? "未收集额外信息" : record.formAnswers);
        boolean revisable = RegistrationManagementActivity.STATUS_PENDING.equals(record.status)
                || AppSettings.canReviseReviewedRegistration(this);
        if (revisable) {
            LinearLayout actions = new LinearLayout(this); actions.setOrientation(LinearLayout.HORIZONTAL);
            Button approve = new Button(this); stylePrimaryButton(approve); approve.setText(R.string.reg_mgmt_approve);
            approve.setOnClickListener(v -> changeStatus(RegistrationManagementActivity.STATUS_APPROVED));
            actions.addView(approve, weighted(0, 6));
            Button reject = new Button(this); styleDangerButton(reject); reject.setText(R.string.reg_mgmt_reject);
            reject.setOnClickListener(v -> changeStatus(RegistrationManagementActivity.STATUS_REJECTED));
            actions.addView(reject, weighted(6, 0)); content.addView(actions, fullWidthParams(10));
        }
    }
    private LinearLayout.LayoutParams weighted(int left, int right) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1); p.setMargins(dp(left), 0, dp(right), 0); return p;
    }
    private void addDetail(String label, String value) {
        addText(content, label, R.color.text_secondary, 13, Typeface.BOLD);
        addText(content, value, R.color.text_primary, 15, Typeface.NORMAL);
    }
    private void changeStatus(String status) {
        RegistrationManagementActivity.updateStatus(recordId, status);
        Toast.makeText(this, status, Toast.LENGTH_SHORT).show(); render();
    }
}
