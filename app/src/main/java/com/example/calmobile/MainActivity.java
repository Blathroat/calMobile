package com.example.calmobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int MONTH_DAYS = 30;

    private static final Exhibition[] SAMPLE_EXHIBITIONS = new Exhibition[] {
            new Exhibition(
                    6,
                    "华南智能制造展",
                    "深圳国际会展中心 6 号馆",
                    "09:30-17:00",
                    "报名中",
                    true,
                    "聚焦工业机器人、柔性产线和数字化工厂方案，适合制造业采购与技术负责人参观。",
                    "智能制造 / 工业自动化"),
            new Exhibition(
                    12,
                    "绿色能源装备展",
                    "广州琶洲展馆 A 区",
                    "10:00-18:00",
                    "报名中",
                    true,
                    "展示储能、电池回收、光伏逆变器和低碳园区方案，现场开放采购对接区。",
                    "新能源 / 储能"),
            new Exhibition(
                    12,
                    "跨境电商选品会",
                    "广州琶洲展馆 B 区",
                    "13:30-20:00",
                    "席位紧张",
                    true,
                    "本地假数据演示：用当天多场展会验证列表、详情和报名表单切换流程。",
                    "电商 / 选品"),
            new Exhibition(
                    21,
                    "城市更新材料展",
                    "上海新国际博览中心",
                    "09:00-16:30",
                    "报名截止",
                    false,
                    "面向建筑材料、节能门窗和旧改服务商的专业展，当前样例设置为不可报名状态。",
                    "建筑材料 / 城市更新")
    };

    private TextView statusText;
    private GridLayout calendarGrid;
    private LinearLayout exhibitionList;
    private LinearLayout detailPanel;
    private LinearLayout registrationPanel;
    private LinearLayout registrationAnswers;
    private EditText nameInput;
    private RadioGroup visitorTypeGroup;
    private CheckBox needMeetingCheck;
    private CheckBox needReminderCheck;
    private TextView registrationResultText;

    private final RegistrationManager registrationManager = new RegistrationManager();
    private LinearLayout myRegistrationsList;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.status_text);
        calendarGrid = findViewById(R.id.calendar_grid);
        exhibitionList = findViewById(R.id.exhibition_list);
        detailPanel = findViewById(R.id.detail_panel);
        registrationPanel = findViewById(R.id.registration_panel);
        registrationAnswers = findViewById(R.id.registration_answers);
        myRegistrationsList = findViewById(R.id.my_registrations_list);

        statusText.setText(R.string.home_status);
        buildMonthGrid();
        showExhibitionsForDay(12);
        showExhibitionDetail(SAMPLE_EXHIBITIONS[1]);
        renderMyRegistrations();

        Button profileButton = findViewById(R.id.go_to_profile_btn);
        profileButton.setAllCaps(false);
        profileButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(MainActivity.this, ProfileActivity.class));
            }
        });

        Button exhibitorBackendButton = findViewById(R.id.go_to_exhibitor_backend_btn);
        exhibitorBackendButton.setAllCaps(false);
        exhibitorBackendButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(MainActivity.this, ExhibitorBackendActivity.class));
            }
        });
    }

    private void buildMonthGrid() {
        calendarGrid.removeAllViews();

        for (int day = 1; day <= MONTH_DAYS; day++) {
            final int selectedDay = day;
            int count = countExhibitionsForDay(day);
            Button dayButton = new Button(this);
            dayButton.setAllCaps(false);
            dayButton.setText(count > 0 ? day + "\n" + count + "场" : String.valueOf(day));
            dayButton.setTextColor(getResources().getColor(count > 0 ? R.color.status_open : R.color.text_secondary));
            dayButton.setTextSize(13);
            dayButton.setBackgroundResource(count > 0 ? R.color.date_active_background : R.color.card_background);
            dayButton.setPadding(0, dp(6), 0, dp(6));
            dayButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showExhibitionsForDay(selectedDay);
                }
            });

            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = 0;
            params.height = dp(64);
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
            params.setMargins(dp(2), dp(2), dp(2), dp(2));
            calendarGrid.addView(dayButton, params);
        }
    }

    private void showExhibitionsForDay(int day) {
        exhibitionList.removeAllViews();
        List<Exhibition> exhibitions = getExhibitionsForDay(day);
        statusText.setText(getString(R.string.local_day_count, day, exhibitions.size()));

        if (exhibitions.isEmpty()) {
            addText(exhibitionList, "当天暂无展会，点击带标记日期查看样例展会。", R.color.text_secondary, 15, Typeface.NORMAL);
            return;
        }

        for (final Exhibition exhibition : exhibitions) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            card.setBackgroundResource(R.color.card_background);
            card.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showExhibitionDetail(exhibition);
                }
            });

            addText(card, exhibition.title, R.color.text_primary, 18, Typeface.BOLD);
            addText(card, exhibition.time + " · " + exhibition.venue, R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, exhibition.status + " · " + exhibition.category, exhibition.openForRegistration ? R.color.status_open : R.color.status_closed, 14, Typeface.BOLD);

            Button detailButton = new Button(this);
            detailButton.setAllCaps(false);
            detailButton.setText(R.string.exhibition_detail);
            detailButton.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showExhibitionDetail(exhibition);
                }
            });
            card.addView(detailButton, fullWidthParams(8));

            exhibitionList.addView(card, fullWidthParams(10));
        }
    }

    private void showExhibitionDetail(final Exhibition exhibition) {
        detailPanel.removeAllViews();
        detailPanel.setVisibility(View.VISIBLE);
        registrationPanel.setVisibility(View.GONE);

        addText(detailPanel, getString(R.string.exhibition_detail), R.color.text_primary, 20, Typeface.BOLD);
        addText(detailPanel, exhibition.title, R.color.text_primary, 18, Typeface.BOLD);
        addText(detailPanel, "时间：6月" + exhibition.day + "日 " + exhibition.time, R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailPanel, "地点：" + exhibition.venue, R.color.text_secondary, 15, Typeface.NORMAL);
        addText(detailPanel, "状态：" + exhibition.status, exhibition.openForRegistration ? R.color.status_open : R.color.status_closed, 15, Typeface.BOLD);
        addText(detailPanel, exhibition.description, R.color.text_primary, 15, Typeface.NORMAL);
        addText(detailPanel, "说明：当前为本地假数据演示，报名结果不会提交到服务器。", R.color.text_secondary, 14, Typeface.NORMAL);

        Button registerButton = new Button(this);
        registerButton.setAllCaps(false);
        registerButton.setText(exhibition.openForRegistration ? R.string.registration_title : R.string.registration_closed);
        registerButton.setEnabled(exhibition.openForRegistration);
        registerButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showRegistrationForm(exhibition);
            }
        });
        detailPanel.addView(registerButton, fullWidthParams(12));
    }

    private void showRegistrationForm(final Exhibition exhibition) {
        registrationPanel.setVisibility(View.VISIBLE);
        registrationAnswers.removeAllViews();

        addText(registrationAnswers, getString(R.string.registration_title), R.color.text_primary, 20, Typeface.BOLD);
        addText(registrationAnswers, exhibition.title, R.color.text_secondary, 15, Typeface.NORMAL);

        nameInput = new EditText(this);
        nameInput.setSingleLine(true);
        nameInput.setInputType(InputType.TYPE_CLASS_TEXT);
        nameInput.setHint("姓名 / 公司名称");
        registrationAnswers.addView(nameInput, fullWidthParams(10));

        addText(registrationAnswers, "参观身份", R.color.text_primary, 15, Typeface.BOLD);
        visitorTypeGroup = new RadioGroup(this);
        visitorTypeGroup.setOrientation(RadioGroup.VERTICAL);
        addVisitorType("专业观众", true);
        addVisitorType("采购负责人", false);
        addVisitorType("媒体或合作伙伴", false);
        registrationAnswers.addView(visitorTypeGroup, fullWidthParams(4));

        addText(registrationAnswers, "报名需求", R.color.text_primary, 15, Typeface.BOLD);
        needMeetingCheck = new CheckBox(this);
        needMeetingCheck.setText("希望安排展商洽谈");
        registrationAnswers.addView(needMeetingCheck, fullWidthParams(2));

        needReminderCheck = new CheckBox(this);
        needReminderCheck.setText("需要开展前提醒");
        needReminderCheck.setChecked(true);
        registrationAnswers.addView(needReminderCheck, fullWidthParams(2));

        Button submitButton = new Button(this);
        submitButton.setAllCaps(false);
        submitButton.setText(R.string.submit_registration);
        submitButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                submitRegistration(exhibition);
            }
        });
        registrationAnswers.addView(submitButton, fullWidthParams(10));

        registrationResultText = addText(registrationAnswers, "填写后点击提交，页面会生成本地演示反馈。", R.color.text_secondary, 14, Typeface.NORMAL);
    }

    private void submitRegistration(Exhibition exhibition) {
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
                exhibition.title,
                exhibition.day,
                exhibition.time,
                exhibition.venue,
                visitorName,
                visitorType,
                needsSummary);

        String message = "已提交报名\n"
                + "展会：" + exhibition.title + "\n"
                + "报名人：" + visitorName + "\n"
                + "身份：" + visitorType + "\n"
                + "需求：" + needsSummary;
        registrationResultText.setText(message);
        Toast.makeText(this, "报名已提交", Toast.LENGTH_SHORT).show();

        renderMyRegistrations();
    }

    private void renderMyRegistrations() {
        myRegistrationsList.removeAllViews();
        List<Registration> registrations = registrationManager.list();

        if (registrations.isEmpty()) {
            addText(myRegistrationsList, getString(R.string.my_registrations_empty),
                    R.color.text_secondary, 14, Typeface.NORMAL);
            return;
        }

        for (final Registration registration : registrations) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(12), dp(14), dp(12));
            card.setBackgroundResource(R.color.card_background);

            addText(card, registration.getExhibitionTitle(),
                    R.color.text_primary, 16, Typeface.BOLD);
            addText(card, "6月" + registration.getExhibitionDay() + "日 "
                            + registration.getExhibitionTime() + " · "
                            + registration.getExhibitionVenue(),
                    R.color.text_secondary, 14, Typeface.NORMAL);
            addText(card, registration.getVisitorName() + " · "
                            + registration.getVisitorType(),
                    R.color.text_primary, 14, Typeface.NORMAL);

            // Make visitor name clickable — opens public profile
            TextView visitorLine = addText(card, getString(R.string.user_public_view_profile_hint),
                    R.color.status_open, 13, Typeface.NORMAL);
            visitorLine.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    openUserPublicProfile(registration);
                }
            });
            String statusLabel = registration.getStatus() == Registration.Status.PENDING
                    ? getString(R.string.status_pending) : getString(R.string.status_cancelled);
            addText(card, statusLabel + " · " + registration.getNeedsSummary(),
                    registration.getStatus() == Registration.Status.PENDING
                            ? R.color.status_open : R.color.status_closed,
                    14, Typeface.BOLD);

            final boolean isCancelled = registration.getStatus() == Registration.Status.CANCELLED;
            if (!isCancelled) {
                Button cancelButton = new Button(this);
                cancelButton.setAllCaps(false);
                cancelButton.setText(R.string.cancel_registration);
                cancelButton.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) {
                        registrationManager.cancel(registration.getId());
                        Toast.makeText(MainActivity.this,
                                R.string.registration_cancelled, Toast.LENGTH_SHORT).show();
                        renderMyRegistrations();
                    }
                });
                card.addView(cancelButton, fullWidthParams(6));
            } else {
                addText(card, getString(R.string.status_cancelled),
                        R.color.status_closed, 14, Typeface.BOLD);
            }

            myRegistrationsList.addView(card, fullWidthParams(8));
        }
    }

    private void openUserPublicProfile(Registration registration) {
        // Collect all registrations for the same visitor
        List<Registration> allRegs = registrationManager.list();
        List<Registration> visitorRegs = new ArrayList<>();
        for (Registration r : allRegs) {
            if (r.getVisitorName().equals(registration.getVisitorName())) {
                visitorRegs.add(r);
            }
        }

        int count = visitorRegs.size();
        String[] titles = new String[count];
        String[] days = new String[count];
        String[] times = new String[count];
        String[] venues = new String[count];
        String[] statuses = new String[count];
        String[] needs = new String[count];

        for (int i = 0; i < count; i++) {
            Registration r = visitorRegs.get(i);
            titles[i] = r.getExhibitionTitle();
            days[i] = "6月" + r.getExhibitionDay() + "日";
            times[i] = r.getExhibitionTime();
            venues[i] = r.getExhibitionVenue();
            statuses[i] = r.getStatus() == Registration.Status.PENDING
                    ? getString(R.string.status_pending) : getString(R.string.status_cancelled);
            needs[i] = r.getNeedsSummary();
        }

        Intent intent = new Intent(this, UserPublicActivity.class);
        intent.putExtra("nickname", registration.getVisitorName());
        intent.putExtra("bio", "");
        intent.putExtra("contact", "");
        intent.putExtra("socialMedia", "");
        intent.putExtra("showRegistrations", true);
        intent.putExtra("isOwnProfile", true);
        intent.putExtra("regExhibitionTitles", titles);
        intent.putExtra("regExhibitionDays", days);
        intent.putExtra("regExhibitionTimes", times);
        intent.putExtra("regExhibitionVenues", venues);
        intent.putExtra("regStatuses", statuses);
        intent.putExtra("regNeedsSummaries", needs);
        startActivity(intent);
    }

    private void addVisitorType(String label, boolean checked) {
        RadioButton radioButton = new RadioButton(this);
        radioButton.setId(View.generateViewId());
        radioButton.setText(label);
        visitorTypeGroup.addView(radioButton, fullWidthParams(0));
        if (checked) {
            visitorTypeGroup.check(radioButton.getId());
        }
    }

    private List<Exhibition> getExhibitionsForDay(int day) {
        List<Exhibition> exhibitions = new ArrayList<>();
        for (Exhibition exhibition : SAMPLE_EXHIBITIONS) {
            if (exhibition.day == day) {
                exhibitions.add(exhibition);
            }
        }
        return exhibitions;
    }

    private int countExhibitionsForDay(int day) {
        int count = 0;
        for (Exhibition exhibition : SAMPLE_EXHIBITIONS) {
            if (exhibition.day == day) {
                count++;
            }
        }
        return count;
    }

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

    private static class Exhibition {
        final int day;
        final String title;
        final String venue;
        final String time;
        final String status;
        final boolean openForRegistration;
        final String description;
        final String category;

        Exhibition(int day, String title, String venue, String time, String status,
                boolean openForRegistration, String description, String category) {
            this.day = day;
            this.title = title;
            this.venue = venue;
            this.time = time;
            this.status = status;
            this.openForRegistration = openForRegistration;
            this.description = description;
            this.category = category;
        }
    }
}
