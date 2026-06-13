package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Displays a user's public profile page.
 *
 * <p>Expected Intent extras:
 * <ul>
 *   <li>{@code nickname} (String) — user display name</li>
 *   <li>{@code bio} (String) — short bio</li>
 *   <li>{@code contact} (String) — contact info</li>
 *   <li>{@code socialMedia} (String) — social media handle</li>
 *   <li>{@code showRegistrations} (boolean) — whether to show registrations section</li>
 *   <li>{@code isOwnProfile} (boolean) — whether to show edit button</li>
 * </ul>
 *
 * <p>Registration data (parallel arrays, optional):
 * <ul>
 *   <li>{@code regExhibitionTitles} (String[])</li>
 *   <li>{@code regExhibitionDays} (String[])</li>
 *   <li>{@code regExhibitionTimes} (String[])</li>
 *   <li>{@code regExhibitionVenues} (String[])</li>
 *   <li>{@code regStatuses} (String[])</li>
 *   <li>{@code regNeedsSummaries} (String[])</li>
 * </ul>
 */
public class UserPublicActivity extends BaseActivity {

    private LinearLayout headerSection;
    private LinearLayout infoSection;
    private LinearLayout registrationsSection;
    private LinearLayout actionsSection;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_user_public);

        headerSection = findViewById(R.id.user_public_header);
        infoSection = findViewById(R.id.user_public_info);
        registrationsSection = findViewById(R.id.user_public_registrations);
        actionsSection = findViewById(R.id.user_public_actions);

        // Back button
        TextView backBtn = findViewById(R.id.user_public_back);
        applyRippleToBackButton(backBtn);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        // Read Intent extras
        Intent intent = getIntent();
        String nickname = intent.getStringExtra("nickname");
        String bio = intent.getStringExtra("bio");
        String contact = intent.getStringExtra("contact");
        String socialMedia = intent.getStringExtra("socialMedia");
        boolean showRegistrations = intent.getBooleanExtra("showRegistrations", false);
        boolean isOwnProfile = intent.getBooleanExtra("isOwnProfile", false);

        if (nickname == null || nickname.length() == 0) {
            nickname = getString(R.string.user_public_unknown_user);
        }
        if (bio == null) bio = "";
        if (contact == null) contact = "";
        if (socialMedia == null) socialMedia = "";

        renderHeader(nickname);
        renderInfo(bio, contact, socialMedia);

        if (showRegistrations) {
            renderRegistrations(intent);
        }

        if (isOwnProfile) {
            renderOwnProfileActions();
        }
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    // ── Render methods ────────────────────────────────────────────────

    private void renderHeader(String nickname) {
        headerSection.removeAllViews();
        headerSection.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        styleCard(headerSection);

        // Avatar placeholder (circle with initial)
        TextView avatar = new TextView(this);
        avatar.setText(nickname.length() > 0 ? nickname.substring(0, 1) : getString(R.string.profile_avatar_initial));
        avatar.setTextColor(getResources().getColor(R.color.card_background));
        avatar.setTextSize(28);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(android.view.Gravity.CENTER);

        int avatarSize = dp(72);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(getResources().getColor(R.color.status_open));
        avatar.setBackground(circle);

        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avatarParams.setMargins(0, dp(8), 0, dp(12));
        headerSection.addView(avatar, avatarParams);

        // Nickname below avatar
        addText(headerSection, nickname, R.color.text_primary, 22, Typeface.BOLD);

        animateShowPanel(headerSection);
    }

    private void renderInfo(String bio, String contact, String socialMedia) {
        infoSection.removeAllViews();
        styleCard(infoSection);

        if (bio.length() > 0) {
            addText(infoSection, getString(R.string.profile_bio_label), R.color.text_secondary, 13, Typeface.NORMAL);
            addText(infoSection, bio, R.color.text_primary, 16, Typeface.NORMAL);
            addDivider(infoSection);
        }

        if (contact.length() > 0) {
            addText(infoSection, getString(R.string.profile_contact_label), R.color.text_secondary, 13, Typeface.NORMAL);
            addText(infoSection, contact, R.color.text_primary, 16, Typeface.NORMAL);
            addDivider(infoSection);
        }

        if (socialMedia.length() > 0) {
            addText(infoSection, getString(R.string.profile_social_label), R.color.text_secondary, 13, Typeface.NORMAL);
            addText(infoSection, socialMedia, R.color.text_primary, 16, Typeface.NORMAL);
        }

        // If all fields are empty, show a placeholder
        if (bio.length() == 0 && contact.length() == 0 && socialMedia.length() == 0) {
            addText(infoSection, getString(R.string.user_public_no_info), R.color.text_secondary, 14, Typeface.NORMAL);
        }

        // Staggered animation
        infoSection.setAlpha(0f);
        infoSection.setTranslationY(dp(16));
        infoSection.animate()
                .alpha(1f).translationY(0)
                .setDuration(300).setStartDelay(120)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    private void renderRegistrations(Intent intent) {
        String[] titles = intent.getStringArrayExtra("regExhibitionTitles");
        String[] days = intent.getStringArrayExtra("regExhibitionDays");
        String[] times = intent.getStringArrayExtra("regExhibitionTimes");
        String[] venues = intent.getStringArrayExtra("regExhibitionVenues");
        String[] statuses = intent.getStringArrayExtra("regStatuses");
        String[] needs = intent.getStringArrayExtra("regNeedsSummaries");

        if (titles == null || titles.length == 0) {
            return;
        }

        registrationsSection.setVisibility(View.VISIBLE);
        registrationsSection.removeAllViews();
        styleCard(registrationsSection);

        addText(registrationsSection, getString(R.string.user_public_registrations_title),
                R.color.text_primary, 17, Typeface.BOLD);

        addDivider(registrationsSection);

        for (int i = 0; i < titles.length; i++) {
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(12), dp(10), dp(12), dp(10));

            GradientDrawable cardBg = new GradientDrawable();
            cardBg.setColor(getResources().getColor(R.color.surface_background));
            cardBg.setCornerRadius(dp(8));
            card.setBackground(cardBg);

            addText(card, titles[i], R.color.text_primary, 15, Typeface.BOLD);

            String dayTime = (days != null && i < days.length ? days[i] : "")
                    + " " + (times != null && i < times.length ? times[i] : "");
            addText(card, dayTime.trim(), R.color.text_secondary, 13, Typeface.NORMAL);

            if (venues != null && i < venues.length && venues[i].length() > 0) {
                addText(card, venues[i], R.color.text_secondary, 13, Typeface.NORMAL);
            }

            if (statuses != null && i < statuses.length) {
                int statusColor = "待参加".equals(statuses[i]) ? R.color.status_open : R.color.status_closed;
                String statusLine = statuses[i];
                if (needs != null && i < needs.length && needs[i].length() > 0) {
                    statusLine += " · " + needs[i];
                }
                addText(card, statusLine, statusColor, 13, Typeface.BOLD);
            }

            registrationsSection.addView(card, fullWidthParams(8));
        }

        // Animate the section and its items
        animateShowPanel(registrationsSection);
        registrationsSection.postDelayed(new Runnable() {
            @Override
            public void run() {
                animateListItems(registrationsSection, 0);
            }
        }, 200);
    }

    private void renderOwnProfileActions() {
        actionsSection.removeAllViews();

        Button editButton = new Button(this);
        editButton.setAllCaps(false);
        editButton.setText(R.string.user_public_edit_profile);
        editButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intent = new Intent(UserPublicActivity.this, ProfileActivity.class);
                startActivity(intent);
                overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
            }
        });
        actionsSection.addView(editButton, fullWidthParams(0));
    }
}
