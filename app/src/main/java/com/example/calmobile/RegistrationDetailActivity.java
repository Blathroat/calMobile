package com.example.calmobile;

import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 展示一位报名人的完整资料，并执行审批操作。 */
public class RegistrationDetailActivity extends BaseActivity {
    public static final String EXTRA_RECORD_ID = "record_id";
    private String recordId;
    private LinearLayout content;
    private LinearLayout statusPicker;

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
        statusPicker = null;
        RegistrationManagementActivity.MgmtRecord record = RegistrationManagementActivity.findRecord(recordId);
        if (record == null) { finish(); return; }
        addText(content, record.visitorName, R.color.text_primary, 21, Typeface.BOLD);
        addDetail("报名时间", record.registrationTime);
        addDetail("审核状态", record.status);
        addDetail("报名信息", record.formAnswers.isEmpty() ? "未收集额外信息" : record.formAnswers);
        boolean revisable = RegistrationManagementActivity.STATUS_PENDING.equals(record.status)
                || AppSettings.canReviseReviewedRegistration(this);
        if (revisable) {
            Button change = new Button(this);
            styleSecondaryButton(change);
            change.setText(R.string.reg_mgmt_change_status);
            change.setOnClickListener(v -> toggleStatusPicker(change, record));
            content.addView(change, fullWidthParams(10));
        }
    }
    private LinearLayout.LayoutParams weighted(int left, int right) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1); p.setMargins(dp(left), 0, dp(right), 0); return p;
    }
    private void addDetail(String label, String value) {
        addText(content, label, R.color.text_secondary, 13, Typeface.BOLD);
        addText(content, value, R.color.text_primary, 15, Typeface.NORMAL);
    }

    /** 在报名卡片内展开审批选项，避免把操作移到页面底部。 */
    private void toggleStatusPicker(Button trigger, RegistrationManagementActivity.MgmtRecord record) {
        if (statusPicker != null && statusPicker.getParent() != null) {
            ((LinearLayout) statusPicker.getParent()).removeView(statusPicker);
            statusPicker = null;
            trigger.setText(R.string.reg_mgmt_change_status);
            return;
        }

        statusPicker = new LinearLayout(this);
        statusPicker.setOrientation(LinearLayout.VERTICAL);
        statusPicker.setPadding(dp(12), dp(12), dp(12), dp(12));
        styleCard(statusPicker);
        addText(statusPicker, getString(R.string.reg_mgmt_status_picker_title),
                R.color.text_primary, 15, Typeface.BOLD);

        addStatusOption(record, RegistrationManagementActivity.STATUS_APPROVED,
                R.string.reg_mgmt_approve, false);
        addStatusOption(record, RegistrationManagementActivity.STATUS_REJECTED,
                R.string.reg_mgmt_reject, true);
        content.addView(statusPicker, fullWidthParams(8));
        trigger.setText(R.string.reg_mgmt_collapse_status);
        animateShowPanel(statusPicker);
    }

    private void addStatusOption(RegistrationManagementActivity.MgmtRecord record,
                                 String status, int labelRes, boolean danger) {
        Button option = new Button(this);
        if (danger) {
            styleDangerButton(option);
        } else {
            stylePrimaryButton(option);
        }
        option.setText(labelRes);
        option.setOnClickListener(v -> changeStatus(status));
        // 选项直接放入当前详情卡片内，保持与触发操作同一层级。
        statusPicker.addView(option, fullWidthParams(6));
    }
    private void changeStatus(String status) {
        RegistrationManagementActivity.updateStatus(recordId, status);
        Toast.makeText(this, status, Toast.LENGTH_SHORT).show(); render();
    }
}
