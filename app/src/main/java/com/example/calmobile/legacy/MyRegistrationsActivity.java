package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/** 普通用户的报名列表，点击卡片进入报名详情。 */
public class MyRegistrationsActivity extends BaseActivity {
    private final RegistrationManager registrationManager = new RegistrationManager();
    private LinearLayout list;
    private TextView count;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!AuthManager.getInstance().canAccessProfile()) {
            finish();
            return;
        }
        setContentView(R.layout.activity_my_registrations);
        list = findViewById(R.id.my_registrations_list);
        count = findViewById(R.id.my_registrations_count);
        TextView back = findViewById(R.id.my_registrations_back);
        applyRippleToBackButton(back);
        back.setOnClickListener(v -> finish());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (list != null) renderList();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    private void renderList() {
        list.removeAllViews();
        List<Registration> registrations = registrationManager.list();
        count.setText(getString(R.string.my_registrations_count, registrations.size()));
        if (registrations.isEmpty()) {
            showEmptyState(list, getString(R.string.my_registrations_empty));
            return;
        }
        for (Registration registration : registrations) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            styleCard(card);

            LinearLayout top = new LinearLayout(this);
            top.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView title = new TextView(this);
            title.setText(registration.getExhibitionTitle());
            title.setTextColor(getResources().getColor(R.color.text_primary));
            title.setTextSize(16);
            title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            top.addView(title, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView badge = new TextView(this);
            boolean cancelled = registration.getStatus() == Registration.Status.CANCELLED;
            badge.setText(cancelled ? getString(R.string.status_cancelled)
                    : getString(R.string.status_pending));
            badge.setTextColor(getResources().getColor(cancelled
                    ? R.color.status_closed : R.color.status_pending));
            badge.setTextSize(12);
            badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            badge.setPadding(dp(8), dp(5), dp(8), dp(5));
            badge.setBackgroundResource(cancelled ? R.drawable.bg_status_badge_closed
                    : R.drawable.bg_status_badge_pending);
            top.addView(badge);
            card.addView(top);

            addText(card, getString(R.string.registration_exhibition_meta,
                    getExhibitionMonth(registration), registration.getExhibitionDay(), registration.getExhibitionTime(),
                    registration.getExhibitionVenue()), R.color.text_secondary, 13, Typeface.NORMAL);
            addText(card, registration.getNeedsSummary().isEmpty()
                    ? "已提交报名信息" : registration.getNeedsSummary(),
                    R.color.text_secondary, 13, Typeface.NORMAL);
            card.setOnClickListener(v -> {
                Intent intent = new Intent(this, MyRegistrationDetailActivity.class);
                intent.putExtra(MyRegistrationDetailActivity.EXTRA_REGISTRATION_ID,
                        registration.getId());
                navigateTo(intent);
            });
            list.addView(card, fullWidthParams(8));
        }
        animateListItems(list, 60);
    }

    /** 从展会扩展配置读取月份，旧记录没有配置时回退到演示用六月。 */
    private int getExhibitionMonth(Registration registration) {
        for (ExhibitorExhibition exhibition : ExhibitionManager.listAll()) {
            if (!registration.getExhibitionTitle().equals(exhibition.getTitle())) continue;
            ExhibitionConfiguration.Data config = ExhibitionConfiguration.get(exhibition.getId());
            if (config != null && config.exhibitionDate != null && config.exhibitionDate.length() >= 7) {
                try {
                    return Integer.parseInt(config.exhibitionDate.substring(5, 7));
                } catch (NumberFormatException ignored) {
                    // 配置格式异常时使用默认月份。
                }
            }
            break;
        }
        return 6;
    }
}
