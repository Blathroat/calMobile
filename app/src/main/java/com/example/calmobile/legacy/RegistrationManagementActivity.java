package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** 展商和管理员查看展会报名记录的列表页面。 */
public class RegistrationManagementActivity extends BaseActivity {
    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";
    public static final String STATUS_PENDING = "待审核";
    public static final String STATUS_APPROVED = "已通过";
    public static final String STATUS_REJECTED = "已拒绝";

    /** 复用 {@link RegistrationReviewStore} 的记录类型，保证与 WebView 前端共享同一份审核数据。 */
    static class MgmtRecord {
        final String id;
        final String exhibitionId;
        final String visitorName;
        final String registrationTime;
        final String formAnswers;
        String status;
        MgmtRecord(String id, String exhibitionId, String visitorName, String registrationTime,
                String formAnswers, String status) {
            this.id = id; this.exhibitionId = exhibitionId; this.visitorName = visitorName;
            this.registrationTime = registrationTime; this.formAnswers = formAnswers; this.status = status;
        }

        static MgmtRecord from(RegistrationReviewStore.Record record) {
            return new MgmtRecord(record.id, record.exhibitionId, record.visitorName,
                    record.registrationTime, record.formAnswers, record.status);
        }
    }

    private LinearLayout listContainer;
    private TextView countText;
    private LinearLayout filterRow;
    private String filterStatus = "全部";
    private String exhibitionId;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canAccessExhibitor()) { finish(); return; }
        setContentView(R.layout.activity_registration_management);
        exhibitionId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID);
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        if (exhibition == null) { finish(); return; }
        RegistrationReviewStore.ensureSeeded(exhibitionId);
        listContainer = findViewById(R.id.reg_mgmt_list);
        countText = findViewById(R.id.reg_mgmt_count);
        filterRow = findViewById(R.id.reg_mgmt_filter_row);
        buildFilterRow();
        ((TextView) findViewById(R.id.reg_mgmt_subtitle)).setText(exhibition.getTitle());
        TextView back = findViewById(R.id.reg_mgmt_back);
        applyRippleToBackButton(back); back.setOnClickListener(v -> finish());
    }

    @Override protected void onResume() { super.onResume(); if (listContainer != null) renderList(); }
    @Override public void finish() { super.finish(); overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right); }

    public static void addSubmittedRecord(String exhibitionId, String visitorName, String answers) {
        RegistrationReviewStore.add(exhibitionId, visitorName, answers);
    }

    static MgmtRecord findRecord(String id) {
        RegistrationReviewStore.Record record = RegistrationReviewStore.find(id);
        return record == null ? null : MgmtRecord.from(record);
    }

    static boolean updateStatus(String id, String status) {
        return RegistrationReviewStore.updateStatus(id, status);
    }

    private void renderList() {
        listContainer.removeAllViews();
        RegistrationReviewStore.ensureSeeded(exhibitionId);
        List<MgmtRecord> records = new ArrayList<>();
        for (RegistrationReviewStore.Record stored : RegistrationReviewStore.listByExhibition(exhibitionId)) {
            if ("全部".equals(filterStatus) || filterStatus.equals(stored.status)) {
                records.add(MgmtRecord.from(stored));
            }
        }
        countText.setText(getString(R.string.reg_mgmt_count, records.size()));
        if (records.isEmpty()) { addText(listContainer, getString(R.string.reg_mgmt_empty), R.color.text_secondary, 15, Typeface.NORMAL); return; }
        for (MgmtRecord record : records) {
            LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12)); styleCard(card);
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
            TextView name = new TextView(this); name.setText(record.visitorName); name.setTextSize(16); name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            name.setTextColor(getResources().getColor(R.color.text_primary)); row.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
            TextView badge = new TextView(this); badge.setText(record.status); badge.setTextSize(12); badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            boolean approved = STATUS_APPROVED.equals(record.status);
            boolean rejected = STATUS_REJECTED.equals(record.status);
            badge.setTextColor(getResources().getColor(approved ? R.color.status_open : rejected ? R.color.status_closed : R.color.status_pending));
            badge.setBackgroundResource(approved ? R.drawable.bg_status_badge
                    : rejected ? R.drawable.bg_status_badge_closed : R.drawable.bg_status_badge_pending);
            badge.setPadding(dp(8), dp(5), dp(8), dp(5));
            row.addView(badge);
            card.addView(row, fullWidthParams(0)); addText(card, record.registrationTime + " · 点击查看报名信息", R.color.text_secondary, 13, Typeface.NORMAL);
            card.setOnClickListener(v -> {
                Intent i = new Intent(this, RegistrationDetailActivity.class);
                i.putExtra(RegistrationDetailActivity.EXTRA_RECORD_ID, record.id);
                navigateTo(i);
            });
            listContainer.addView(card, fullWidthParams(8));
        }
        animateListItems(listContainer, 80);
    }

    /** 按 newUI 的分段控件筛选待审核、已通过和已拒绝报名。 */
    private void buildFilterRow() {
        filterRow.removeAllViews();
        String[] labels = {"全部", STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED};
        for (String label : labels) {
            Button button = new Button(this);
            button.setAllCaps(false);
            button.setText(label);
            button.setTextSize(12);
            button.setStateListAnimator(null);
            button.setMinHeight(dp(40));
            button.setMinimumHeight(dp(40));
            button.setOnClickListener(v -> {
                filterStatus = label;
                styleFilterButtons();
                renderList();
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            params.setMargins(dp(2), 0, dp(2), 0);
            filterRow.addView(button, params);
        }
        styleFilterButtons();
    }

    private void styleFilterButtons() {
        for (int i = 0; i < filterRow.getChildCount(); i++) {
            Button button = (Button) filterRow.getChildAt(i);
            boolean active = button.getText().toString().equals(filterStatus);
            GradientDrawable background = new GradientDrawable();
            background.setCornerRadius(dp(8));
            background.setColor(getResources().getColor(active
                    ? R.color.tab_active_bg : R.color.card_background));
            if (!active) background.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
            button.setBackground(background);
            button.setTextColor(getResources().getColor(active
                    ? R.color.tab_active_text : R.color.text_secondary));
        }
    }
}
