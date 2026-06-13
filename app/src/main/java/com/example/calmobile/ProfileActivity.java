package com.example.calmobile;

import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * User profile activity allowing users to view and edit their profile,
 * manage notification settings, and view notification history.
 */
public class ProfileActivity extends BaseActivity {

    /** In-memory profile data (static to survive activity recreation within process). */
    private static String nickname = "";
    private static String bio = "";
    private static String contact = "";
    private static String socialMedia = "";

    private boolean editing = false;

    private LinearLayout headerSection;
    private LinearLayout infoSection;
    private LinearLayout editFieldsSection;
    private LinearLayout actionsSection;
    private LinearLayout notificationSettingsSection;
    private LinearLayout notificationHistorySection;

    private EditText nicknameInput;
    private EditText bioInput;
    private EditText contactInput;
    private EditText socialInput;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_profile);

        headerSection = findViewById(R.id.profile_header);
        infoSection = findViewById(R.id.profile_info);
        editFieldsSection = findViewById(R.id.profile_edit_fields);
        actionsSection = findViewById(R.id.profile_actions);
        notificationSettingsSection = findViewById(R.id.profile_notification_settings);
        notificationHistorySection = findViewById(R.id.profile_notification_history);

        // Request notification permission on API 33+
        NotificationHelper.getInstance(this).requestNotificationPermission(this);

        // Apply defaults on first launch
        if (nickname.length() == 0) {
            nickname = getString(R.string.profile_default_nickname);
            bio = getString(R.string.profile_default_bio);
            contact = getString(R.string.profile_default_contact);
            socialMedia = getString(R.string.profile_default_social);
        }

        TextView backBtn = findViewById(R.id.profile_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        renderDisplayMode();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Display mode ──────────────────────────────────────────────────

    private void renderDisplayMode() {
        editing = false;

        // --- Header: avatar + nickname ---
        headerSection.removeAllViews();
        headerSection.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        styleCard(headerSection);

        // Avatar placeholder (circle with initial)
        TextView avatar = new TextView(this);
        avatar.setText(nickname.length() > 0 ? nickname.substring(0, 1) : getString(R.string.profile_avatar_initial));
        avatar.setTextColor(getResources().getColor(R.color.avatar_text));
        avatar.setTextSize(28);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(android.view.Gravity.CENTER);

        int avatarSize = dp(72);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(getResources().getColor(R.color.avatar_bg));
        avatar.setBackground(circle);

        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avatarParams.setMargins(0, dp(8), 0, dp(12));
        headerSection.addView(avatar, avatarParams);

        // Nickname below avatar
        addText(headerSection, nickname, R.color.text_primary, 22, Typeface.BOLD);

        // --- Info section ---
        infoSection.removeAllViews();
        infoSection.setVisibility(View.VISIBLE);
        styleCard(infoSection);

        addText(infoSection, getString(R.string.profile_bio_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, bio, R.color.text_primary, 16, Typeface.NORMAL);

        addDivider(infoSection);

        addText(infoSection, getString(R.string.profile_contact_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, contact, R.color.text_primary, 16, Typeface.NORMAL);

        addDivider(infoSection);

        addText(infoSection, getString(R.string.profile_social_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, socialMedia, R.color.text_primary, 16, Typeface.NORMAL);

        // Animate header and info in
        animateShowPanel(headerSection);
        infoSection.setAlpha(0f);
        infoSection.setTranslationY(dp(16));
        infoSection.animate()
                .alpha(1f).translationY(0)
                .setDuration(300).setStartDelay(100)
                .setInterpolator(new DecelerateInterpolator()).start();

        // --- Notification settings ---
        renderNotificationSettings();

        // --- Notification history ---
        renderNotificationHistory();

        // --- Hide edit section ---
        editFieldsSection.setVisibility(View.GONE);

        // --- Actions: edit button only ---
        actionsSection.removeAllViews();
        Button editButton = new Button(this);
        editButton.setAllCaps(false);
        editButton.setText(R.string.profile_edit);
        editButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                renderEditMode();
            }
        });
        actionsSection.addView(editButton, fullWidthParams(0));
    }

    // ── Notification settings ────────────────────────────────────────

    private void renderNotificationSettings() {
        notificationSettingsSection.removeAllViews();
        notificationSettingsSection.setVisibility(View.VISIBLE);
        styleCard(notificationSettingsSection);

        final NotificationHelper helper = NotificationHelper.getInstance(this);

        addText(notificationSettingsSection, getString(R.string.notification_settings_title),
                R.color.text_primary, 17, Typeface.BOLD);

        // Exhibition reminders toggle
        CheckBox exhibitionToggle = new CheckBox(this);
        exhibitionToggle.setText(getString(R.string.notification_exhibition_reminder));
        exhibitionToggle.setChecked(helper.isExhibitionReminderEnabled());
        exhibitionToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CheckBox cb = (CheckBox) v;
                helper.setExhibitionReminderEnabled(cb.isChecked());
                Toast.makeText(ProfileActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notificationSettingsSection.addView(exhibitionToggle, fullWidthParams(4));

        addText(notificationSettingsSection, getString(R.string.notification_exhibition_reminder_desc),
                R.color.text_secondary, 12, Typeface.NORMAL);

        // Registration updates toggle
        CheckBox registrationToggle = new CheckBox(this);
        registrationToggle.setText(getString(R.string.notification_registration_updates));
        registrationToggle.setChecked(helper.isRegistrationUpdatesEnabled());
        registrationToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CheckBox cb = (CheckBox) v;
                helper.setRegistrationUpdatesEnabled(cb.isChecked());
                Toast.makeText(ProfileActivity.this,
                        R.string.notification_settings_saved, Toast.LENGTH_SHORT).show();
            }
        });
        notificationSettingsSection.addView(registrationToggle, fullWidthParams(4));

        addText(notificationSettingsSection, getString(R.string.notification_registration_updates_desc),
                R.color.text_secondary, 12, Typeface.NORMAL);

        // Permission hint (if not granted)
        if (!helper.hasNotificationPermission()) {
            addText(notificationSettingsSection, getString(R.string.notification_permission_hint),
                    R.color.status_pending, 13, Typeface.NORMAL);

            Button permBtn = new Button(this);
            permBtn.setAllCaps(false);
            permBtn.setText(R.string.notification_permission_hint);
            permBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    helper.requestNotificationPermission(ProfileActivity.this);
                }
            });
            notificationSettingsSection.addView(permBtn, fullWidthParams(4));
        }

        // Staggered animation
        notificationSettingsSection.setAlpha(0f);
        notificationSettingsSection.setTranslationY(dp(16));
        notificationSettingsSection.animate()
                .alpha(1f).translationY(0)
                .setDuration(300).setStartDelay(200)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    // ── Notification history ─────────────────────────────────────────

    private void renderNotificationHistory() {
        notificationHistorySection.removeAllViews();
        notificationHistorySection.setVisibility(View.VISIBLE);
        styleCard(notificationHistorySection);

        final NotificationHelper helper = NotificationHelper.getInstance(this);
        List<NotificationHelper.NotificationRecord> records = helper.getHistory();

        addText(notificationHistorySection, getString(R.string.notification_history_title),
                R.color.text_primary, 17, Typeface.BOLD);

        addText(notificationHistorySection,
                getString(R.string.notification_history_count, records.size()),
                R.color.text_secondary, 13, Typeface.NORMAL);

        if (records.isEmpty()) {
            addText(notificationHistorySection, getString(R.string.notification_history_empty),
                    R.color.text_secondary, 14, Typeface.NORMAL);
        } else {
            SimpleDateFormat sdf = new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault());

            for (NotificationHelper.NotificationRecord record : records) {
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(12), dp(8), dp(12), dp(8));

                GradientDrawable rowBg = new GradientDrawable();
                rowBg.setColor(getResources().getColor(R.color.surface_variant));
                rowBg.setCornerRadius(dp(8));
                row.setBackground(rowBg);

                // Type + time
                String timeStr = sdf.format(new Date(record.timestamp));
                addText(row, record.type + " · " + timeStr,
                        R.color.text_secondary, 12, Typeface.NORMAL);

                // Title
                addText(row, record.relatedTitle,
                        R.color.text_primary, 14, Typeface.BOLD);

                // Message preview
                String preview = record.message.length() > 60
                        ? record.message.substring(0, 60) + "…"
                        : record.message;
                addText(row, preview, R.color.text_secondary, 13, Typeface.NORMAL);

                notificationHistorySection.addView(row, fullWidthParams(6));
            }
        }

        // Clear history button
        if (!records.isEmpty()) {
            Button clearBtn = new Button(this);
            clearBtn.setAllCaps(false);
            clearBtn.setText(R.string.notification_clear_history);
            clearBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showConfirmDialog(
                            "确定清除所有通知历史？",
                            new Runnable() {
                                @Override
                                public void run() {
                                    helper.clearHistory();
                                    renderNotificationHistory();
                                    Toast.makeText(ProfileActivity.this,
                                            "通知历史已清除", Toast.LENGTH_SHORT).show();
                                }
                            });
                }
            });
            notificationHistorySection.addView(clearBtn, fullWidthParams(8));
        }

        // Staggered animation
        notificationHistorySection.setAlpha(0f);
        notificationHistorySection.setTranslationY(dp(16));
        notificationHistorySection.animate()
                .alpha(1f).translationY(0)
                .setDuration(300).setStartDelay(300)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    // ── Edit mode ─────────────────────────────────────────────────────

    private void renderEditMode() {
        editing = true;

        // Animate info out, then show edit
        animateHidePanel(infoSection);

        // Show edit fields after a brief delay
        editFieldsSection.postDelayed(new Runnable() {
            @Override
            public void run() {
                showEditFields();
            }
        }, 220);
    }

    private void showEditFields() {
        editFieldsSection.removeAllViews();
        styleCard(editFieldsSection);
        animateShowPanel(editFieldsSection);

        // Nickname
        addText(editFieldsSection, getString(R.string.profile_nickname_label), R.color.text_secondary, 13, Typeface.BOLD);
        nicknameInput = new EditText(this);
        nicknameInput.setSingleLine(true);
        nicknameInput.setInputType(InputType.TYPE_CLASS_TEXT);
        nicknameInput.setText(nickname);
        editFieldsSection.addView(nicknameInput, fullWidthParams(4));

        // Bio
        addText(editFieldsSection, getString(R.string.profile_bio_label), R.color.text_secondary, 13, Typeface.BOLD);
        bioInput = new EditText(this);
        bioInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        bioInput.setMinLines(2);
        bioInput.setText(bio);
        editFieldsSection.addView(bioInput, fullWidthParams(4));

        // Contact
        addText(editFieldsSection, getString(R.string.profile_contact_label), R.color.text_secondary, 13, Typeface.BOLD);
        contactInput = new EditText(this);
        contactInput.setSingleLine(true);
        contactInput.setInputType(InputType.TYPE_CLASS_TEXT);
        contactInput.setText(contact);
        editFieldsSection.addView(contactInput, fullWidthParams(4));

        // Social media
        addText(editFieldsSection, getString(R.string.profile_social_label), R.color.text_secondary, 13, Typeface.BOLD);
        socialInput = new EditText(this);
        socialInput.setSingleLine(true);
        socialInput.setInputType(InputType.TYPE_CLASS_TEXT);
        socialInput.setText(socialMedia);
        editFieldsSection.addView(socialInput, fullWidthParams(4));

        // --- Actions: save + cancel ---
        actionsSection.removeAllViews();

        Button saveButton = new Button(this);
        saveButton.setAllCaps(false);
        saveButton.setText(R.string.profile_save);
        saveButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveProfile();
            }
        });

        Button cancelButton = new Button(this);
        cancelButton.setAllCaps(false);
        cancelButton.setText(R.string.profile_cancel);
        cancelButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showConfirmDialog(
                        getString(R.string.confirm_cancel_edit),
                        new Runnable() {
                            @Override
                            public void run() {
                                renderDisplayMode();
                            }
                        });
            }
        });

        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        saveParams.setMargins(0, 0, dp(6), 0);

        LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        cancelParams.setMargins(dp(6), 0, 0, 0);

        actionsSection.addView(saveButton, saveParams);
        actionsSection.addView(cancelButton, cancelParams);
    }

    private void saveProfile() {
        String newNickname = nicknameInput.getText().toString().trim();
        String newBio = bioInput.getText().toString().trim();
        String newContact = contactInput.getText().toString().trim();
        String newSocial = socialInput.getText().toString().trim();

        if (newNickname.length() == 0) {
            newNickname = getString(R.string.profile_default_nickname);
        }

        nickname = newNickname;
        bio = newBio;
        contact = newContact;
        socialMedia = newSocial;

        Toast.makeText(this, R.string.profile_saved, Toast.LENGTH_SHORT).show();
        renderDisplayMode();
    }
}
