package com.example.calmobile;

import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class ProfileActivity extends Activity {

    // In-memory profile data (static to survive activity recreation within process)
    private static String nickname = "";
    private static String bio = "";
    private static String contact = "";
    private static String socialMedia = "";

    private boolean editing = false;

    private LinearLayout headerSection;
    private LinearLayout infoSection;
    private LinearLayout editFieldsSection;
    private LinearLayout actionsSection;

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

        // Apply defaults on first launch
        if (nickname.length() == 0) {
            nickname = getString(R.string.profile_default_nickname);
            bio = getString(R.string.profile_default_bio);
            contact = getString(R.string.profile_default_contact);
            socialMedia = getString(R.string.profile_default_social);
        }

        TextView backBtn = findViewById(R.id.profile_back);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        renderDisplayMode();
    }

    private void renderDisplayMode() {
        editing = false;

        // --- Header: avatar + nickname ---
        headerSection.removeAllViews();
        headerSection.setGravity(android.view.Gravity.CENTER_HORIZONTAL);

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

        // --- Info section ---
        infoSection.removeAllViews();

        addText(infoSection, getString(R.string.profile_bio_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, bio, R.color.text_primary, 16, Typeface.NORMAL);

        addDivider(infoSection);

        addText(infoSection, getString(R.string.profile_contact_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, contact, R.color.text_primary, 16, Typeface.NORMAL);

        addDivider(infoSection);

        addText(infoSection, getString(R.string.profile_social_label), R.color.text_secondary, 13, Typeface.NORMAL);
        addText(infoSection, socialMedia, R.color.text_primary, 16, Typeface.NORMAL);

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

    private void renderEditMode() {
        editing = true;

        // Hide info, show edit fields
        infoSection.setVisibility(View.GONE);
        editFieldsSection.setVisibility(View.VISIBLE);
        editFieldsSection.removeAllViews();

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
                renderDisplayMode();
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

    // --- Helpers (same patterns as MainActivity) ---

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

    private void addDivider(LinearLayout parent) {
        View divider = new View(this);
        divider.setBackgroundColor(getResources().getColor(R.color.text_secondary));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1));
        params.setMargins(0, dp(12), 0, dp(4));
        parent.addView(divider, params);
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
