package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** 展商和管理员查看展会报名记录的列表页面。 */
public class RegistrationManagementActivity extends BaseActivity {
    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";
    public static final String STATUS_PENDING = "待审核";
    public static final String STATUS_APPROVED = "已通过";
    public static final String STATUS_REJECTED = "已拒绝";

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
    }

    private static final List<MgmtRecord> RECORDS = new ArrayList<>();
    private static int nextId = 1;
    private LinearLayout listContainer;
    private TextView countText;
    private String exhibitionId;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!AuthManager.getInstance().canAccessExhibitor()) { finish(); return; }
        setContentView(R.layout.activity_registration_management);
        exhibitionId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID);
        ExhibitorExhibition exhibition = ExhibitionManager.findById(exhibitionId);
        if (exhibition == null) { finish(); return; }
        ensureSeeded(exhibitionId);
        listContainer = findViewById(R.id.reg_mgmt_list);
        countText = findViewById(R.id.reg_mgmt_count);
        ((TextView) findViewById(R.id.reg_mgmt_subtitle)).setText(exhibition.getTitle());
        TextView back = findViewById(R.id.reg_mgmt_back);
        applyRippleToBackButton(back); back.setOnClickListener(v -> finish());
    }

    @Override protected void onResume() { super.onResume(); if (listContainer != null) renderList(); }
    @Override public void finish() { super.finish(); overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right); }

    public static void addSubmittedRecord(String exhibitionId, String visitorName, String answers) {
        RECORDS.add(new MgmtRecord("registration-" + nextId++, exhibitionId, visitorName,
                new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(new Date()), answers, STATUS_PENDING));
    }
    private static void ensureSeeded(String id) {
        for (MgmtRecord record : RECORDS) if (id.equals(record.exhibitionId)) return;
        RECORDS.add(new MgmtRecord("registration-" + nextId++, id, "张伟", "06-08 09:15", "兴趣方向：智能家居\n洽谈需求：是", STATUS_PENDING));
        RECORDS.add(new MgmtRecord("registration-" + nextId++, id, "李娜", "06-08 10:30", "兴趣方向：全屋方案\n洽谈需求：否", STATUS_APPROVED));
    }
    static MgmtRecord findRecord(String id) {
        for (MgmtRecord record : RECORDS) if (record.id.equals(id)) return record;
        return null;
    }
    static boolean updateStatus(String id, String status) {
        MgmtRecord record = findRecord(id); if (record == null) return false; record.status = status; return true;
    }

    private void renderList() {
        listContainer.removeAllViews();
        List<MgmtRecord> records = new ArrayList<>();
        for (MgmtRecord record : RECORDS) if (exhibitionId == null ? record.exhibitionId == null : exhibitionId.equals(record.exhibitionId)) records.add(record);
        countText.setText(getString(R.string.reg_mgmt_count, records.size()));
        if (records.isEmpty()) { addText(listContainer, getString(R.string.reg_mgmt_empty), R.color.text_secondary, 15, Typeface.NORMAL); return; }
        for (MgmtRecord record : records) {
            LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12)); styleCard(card);
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
            TextView name = new TextView(this); name.setText(record.visitorName); name.setTextSize(16); name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            name.setTextColor(getResources().getColor(R.color.text_primary)); row.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
            TextView badge = new TextView(this); badge.setText(record.status); badge.setTextSize(13); badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            badge.setTextColor(getResources().getColor(STATUS_APPROVED.equals(record.status) ? R.color.status_open : STATUS_REJECTED.equals(record.status) ? R.color.status_closed : R.color.status_pending)); row.addView(badge);
            card.addView(row, fullWidthParams(0)); addText(card, record.registrationTime + " · 点击查看报名信息", R.color.text_secondary, 13, Typeface.NORMAL);
            card.setOnClickListener(v -> { Intent i = new Intent(this, RegistrationDetailActivity.class); i.putExtra(RegistrationDetailActivity.EXTRA_RECORD_ID, record.id); startActivity(i); });
            listContainer.addView(card, fullWidthParams(8));
        }
        animateListItems(listContainer, 80);
    }
}
