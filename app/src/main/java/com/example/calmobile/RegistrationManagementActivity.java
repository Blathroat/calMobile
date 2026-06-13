package com.example.calmobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Registration management activity for exhibitors.
 * Displays registration records for a specific exhibition,
 * allows approving/rejecting pending registrations, and shows details.
 */
public class RegistrationManagementActivity extends Activity {

    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";

    /** Simple in-memory registration record for management purposes. */
    static class MgmtRecord {
        final String id;
        final String exhibitionId;
        final String visitorName;
        final String visitorType;
        final String registrationTime;
        final String formAnswers;
        String status; // "待审核", "已通过", "已拒绝"

        MgmtRecord(String id, String exhibitionId, String visitorName, String visitorType,
                String registrationTime, String formAnswers, String status) {
            this.id = id;
            this.exhibitionId = exhibitionId;
            this.visitorName = visitorName;
            this.visitorType = visitorType;
            this.registrationTime = registrationTime;
            this.formAnswers = formAnswers;
            this.status = status;
        }
    }

    // In-memory storage (session-only, no persistence)
    private static final List<MgmtRecord> allRecords = new ArrayList<>();
    private static int nextId = 1;
    private static boolean seeded = false;

    private LinearLayout listContainer;
    private LinearLayout detailPanel;
    private TextView countText;

    private String exhibitionId;
    private ExhibitorExhibition exhibition;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_registration_management);

        exhibitionId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID);
        if (exhibitionId == null) {
            finish();
            return;
        }

        ExhibitionManager.ensureInitialized();
        exhibition = ExhibitionManager.findById(exhibitionId);
        if (exhibition == null) {
            finish();
            return;
        }

        // Seed sample data once
        ensureSeeded(exhibitionId);

        listContainer = findViewById(R.id.reg_mgmt_list);
        detailPanel = findViewById(R.id.reg_mgmt_detail);
        countText = findViewById(R.id.reg_mgmt_count);

        // Subtitle
        TextView subtitle = findViewById(R.id.reg_mgmt_subtitle);
        subtitle.setText(exhibition.getTitle());

        // Back button
        TextView backBtn = findViewById(R.id.reg_mgmt_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        renderList();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Panel animation helpers ───────────────────────────────────────

    private void animateShowPanel(final View panel) {
        panel.setVisibility(View.VISIBLE);
        panel.setAlpha(0f);
        panel.setTranslationY(dp(20));
        panel.animate()
                .alpha(1f)
                .translationY(0)
                .setDuration(300)
                .setInterpolator(new DecelerateInterpolator())
                .setListener(null)
                .start();
    }

    private void animateHidePanel(final View panel) {
        panel.animate()
                .alpha(0f)
                .translationY(dp(10))
                .setDuration(200)
                .setInterpolator(new DecelerateInterpolator())
                .setListener(new AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(Animator animation) {
                        panel.setVisibility(View.GONE);
                        panel.setAlpha(1f);
                        panel.setTranslationY(0);
                    }
                })
                .start();
    }

    // ── Staggered list item animation ─────────────────────────────────

    private void animateListItems(LinearLayout container, int startDelay) {
        for (int i = 0; i < container.getChildCount(); i++) {
            View child = container.getChildAt(i);
            child.setAlpha(0f);
            child.setTranslationY(dp(16));
            child.animate()
                    .alpha(1f)
                    .translationY(0)
                    .setDuration(300)
                    .setStartDelay(startDelay + i * 60)
                    .setInterpolator(new DecelerateInterpolator())
                    .start();
        }
    }

    // ── Card styling helper ───────────────────────────────────────────

    private void styleCard(LinearLayout card) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        card.setBackground(bg);
        card.setElevation(dp(2));
    }

    private void applyRippleToBackButton(TextView btn) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(20));
        shape.setColor(android.graphics.Color.TRANSPARENT);

        RippleDrawable ripple = new RippleDrawable(
                android.content.res.ColorStateList.valueOf(getResources().getColor(R.color.ripple_color)),
                shape, null);
        btn.setBackground(ripple);
        btn.setPadding(dp(12), dp(6), dp(12), dp(6));
    }

    // ── Confirmation dialog helper ────────────────────────────────────

    private void showConfirmDialog(String message, final Runnable onConfirm) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.confirm_title)
                .setMessage(message)
                .setPositiveButton(R.string.confirm_yes, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        onConfirm.run();
                    }
                })
                .setNegativeButton(R.string.confirm_no, null)
                .show();
    }

    // ── Seed sample data ─────────────────────────────────────────────

    private static void ensureSeeded(String exhId) {
        if (seeded) {
            return;
        }
        seeded = true;

        allRecords.add(new MgmtRecord("mgmt-" + nextId++, exhId,
                "张伟", "专业观众", "06-08 09:15",
                "感兴趣领域：智能家居\n需要洽谈：是", STATUS_PENDING));
        allRecords.add(new MgmtRecord("mgmt-" + nextId++, exhId,
                "李娜", "采购负责人", "06-08 10:30",
                "感兴趣领域：全屋方案\n需要洽谈：否", STATUS_PENDING));
        allRecords.add(new MgmtRecord("mgmt-" + nextId++, exhId,
                "王磊", "媒体或合作伙伴", "06-08 11:45",
                "感兴趣领域：行业趋势\n需要洽谈：是", STATUS_APPROVED));
        allRecords.add(new MgmtRecord("mgmt-" + nextId++, exhId,
                "赵敏", "专业观众", "06-09 08:20",
                "感兴趣领域：节能家电\n需要洽谈：否", STATUS_REJECTED));
        allRecords.add(new MgmtRecord("mgmt-" + nextId++, exhId,
                "陈晨", "采购负责人", "06-09 14:00",
                "感兴趣领域：智能门锁\n需要洽谈：是", STATUS_PENDING));
    }

    // ── List rendering ───────────────────────────────────────────────

    private void renderList() {
        listContainer.removeAllViews();
        animateHidePanel(detailPanel);

        List<MgmtRecord> records = getRecordsForExhibition(exhibitionId);

        countText.setText(getString(R.string.reg_mgmt_count, records.size()));

        if (records.isEmpty()) {
            addText(listContainer, getString(R.string.reg_mgmt_empty),
                    R.color.text_secondary, 15, Typeface.NORMAL);
            return;
        }

        for (final MgmtRecord record : records) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            // Visitor name + type row
            LinearLayout nameRow = new LinearLayout(this);
            nameRow.setOrientation(LinearLayout.HORIZONTAL);

            TextView nameText = new TextView(this);
            nameText.setText(record.visitorName);
            nameText.setTextColor(getResources().getColor(R.color.text_primary));
            nameText.setTextSize(16);
            nameText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            nameRow.addView(nameText, nameParams);

            // Status badge
            TextView statusBadge = new TextView(this);
            statusBadge.setText(record.status);
            statusBadge.setTextColor(getResources().getColor(getStatusColor(record.status)));
            statusBadge.setTextSize(13);
            statusBadge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            nameRow.addView(statusBadge, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT));

            card.addView(nameRow, fullWidthParams(0));

            // Visitor type + time
            addText(card, record.visitorType + " · " + record.registrationTime,
                    R.color.text_secondary, 13, Typeface.NORMAL);

            // Click to show detail
            card.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showDetail(record);
                }
            });

            listContainer.addView(card, fullWidthParams(8));
        }

        animateListItems(listContainer, 100);
    }

    // ── Detail panel ─────────────────────────────────────────────────

    private void showDetail(final MgmtRecord record) {
        animateShowPanel(detailPanel);
        detailPanel.removeAllViews();

        // Title
        addText(detailPanel, getString(R.string.reg_mgmt_detail_title),
                R.color.text_primary, 18, Typeface.BOLD);

        // Visitor info
        addDetailRow(getString(R.string.reg_mgmt_label_name), record.visitorName);
        addDetailRow(getString(R.string.reg_mgmt_label_type), record.visitorType);
        addDetailRow(getString(R.string.reg_mgmt_label_time), record.registrationTime);
        addDetailRow(getString(R.string.reg_mgmt_label_status), record.status);
        addDetailRow(getString(R.string.reg_mgmt_label_answers), record.formAnswers);

        // Approve / Reject buttons (only for pending)
        if (STATUS_PENDING.equals(record.status)) {
            LinearLayout buttons = new LinearLayout(this);
            buttons.setOrientation(LinearLayout.HORIZONTAL);

            Button approveBtn = new Button(this);
            approveBtn.setAllCaps(false);
            approveBtn.setText(R.string.reg_mgmt_approve);
            approveBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showConfirmDialog(
                            getString(R.string.confirm_approve),
                            new Runnable() {
                                @Override
                                public void run() {
                                    record.status = STATUS_APPROVED;
                                    NotificationHelper.getInstance(RegistrationManagementActivity.this)
                                            .sendRegistrationStatusNotification(
                                                    exhibition.getTitle(),
                                                    record.visitorName,
                                                    STATUS_APPROVED);
                                    Toast.makeText(RegistrationManagementActivity.this,
                                            R.string.reg_mgmt_approved, Toast.LENGTH_SHORT).show();
                                    renderList();
                                }
                            });
                }
            });
            LinearLayout.LayoutParams approveParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            approveParams.setMargins(0, dp(8), dp(6), 0);
            buttons.addView(approveBtn, approveParams);

            Button rejectBtn = new Button(this);
            rejectBtn.setAllCaps(false);
            rejectBtn.setText(R.string.reg_mgmt_reject);
            rejectBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showConfirmDialog(
                            getString(R.string.confirm_reject),
                            new Runnable() {
                                @Override
                                public void run() {
                                    record.status = STATUS_REJECTED;
                                    NotificationHelper.getInstance(RegistrationManagementActivity.this)
                                            .sendRegistrationStatusNotification(
                                                    exhibition.getTitle(),
                                                    record.visitorName,
                                                    STATUS_REJECTED);
                                    Toast.makeText(RegistrationManagementActivity.this,
                                            R.string.reg_mgmt_rejected, Toast.LENGTH_SHORT).show();
                                    renderList();
                                }
                            });
                }
            });
            LinearLayout.LayoutParams rejectParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            rejectParams.setMargins(dp(6), dp(8), 0, 0);
            buttons.addView(rejectBtn, rejectParams);

            detailPanel.addView(buttons, fullWidthParams(0));
        }

        // Close detail button
        Button closeBtn = new Button(this);
        closeBtn.setAllCaps(false);
        closeBtn.setText(R.string.reg_mgmt_close_detail);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                animateHidePanel(detailPanel);
            }
        });
        detailPanel.addView(closeBtn, fullWidthParams(10));
    }

    private void addDetailRow(String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(6), 0, dp(2));

        TextView labelText = new TextView(this);
        labelText.setText(label);
        labelText.setTextColor(getResources().getColor(R.color.text_secondary));
        labelText.setTextSize(12);
        labelText.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        row.addView(labelText, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView valueText = new TextView(this);
        valueText.setText(value);
        valueText.setTextColor(getResources().getColor(R.color.text_primary));
        valueText.setTextSize(15);
        valueText.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        valueText.setLineSpacing(0, 1.3f);
        row.addView(valueText, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        detailPanel.addView(row, fullWidthParams(0));
    }

    // ── Data helpers ─────────────────────────────────────────────────

    private static final String STATUS_PENDING = "待审核";
    private static final String STATUS_APPROVED = "已通过";
    private static final String STATUS_REJECTED = "已拒绝";

    private static List<MgmtRecord> getRecordsForExhibition(String exhId) {
        List<MgmtRecord> result = new ArrayList<>();
        for (MgmtRecord r : allRecords) {
            if (r.exhibitionId.equals(exhId)) {
                result.add(r);
            }
        }
        return result;
    }

    private static int getStatusColor(String status) {
        if (STATUS_APPROVED.equals(status)) {
            return R.color.status_open;
        } else if (STATUS_REJECTED.equals(status)) {
            return R.color.status_closed;
        } else {
            return R.color.status_pending;
        }
    }

    // ── UI helpers ───────────────────────────────────────────────────

    private TextView addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style) {
        TextView textView = new TextView(this);
        textView.setText(text);
        textView.setTextColor(getResources().getColor(colorRes));
        textView.setTextSize(sizeSp);
        textView.setTypeface(Typeface.DEFAULT, style);
        textView.setLineSpacing(0, 1.15f);
        parent.addView(textView, fullWidthParams(6));
        return textView;
    }

    private LinearLayout.LayoutParams fullWidthParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}
