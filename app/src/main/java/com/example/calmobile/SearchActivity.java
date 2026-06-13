package com.example.calmobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/**
 * Unified search activity for finding exhibitions and users.
 * Supports real-time filtering, search history (in-memory, last 10),
 * and displays results from both ExhibitionManager and AdminUserManager.
 */
public class SearchActivity extends Activity {

    private static final int MAX_HISTORY = 10;

    private EditText searchInput;
    private Button searchButton;
    private LinearLayout searchHistorySection;
    private LinearLayout searchHistoryList;
    private Button clearHistoryButton;
    private TextView resultsCount;
    private LinearLayout resultsList;

    private final List<String> searchHistory = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_search);

        // Initialize managers
        ExhibitionManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        // Bind views
        searchInput = findViewById(R.id.search_input);
        searchButton = findViewById(R.id.search_btn);
        searchHistorySection = findViewById(R.id.search_history_section);
        searchHistoryList = findViewById(R.id.search_history_list);
        clearHistoryButton = findViewById(R.id.search_clear_history_btn);
        resultsCount = findViewById(R.id.search_results_count);
        resultsList = findViewById(R.id.search_results_list);

        // Back button
        Button backButton = findViewById(R.id.search_back_btn);
        backButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        // Search button click
        searchButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                performSearch();
            }
        });

        // Real-time filtering on text change
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                String query = s.toString().trim();
                if (query.isEmpty()) {
                    clearResults();
                    showHistory();
                } else {
                    performSearchInternal(query, false);
                }
            }
        });

        // Clear history
        clearHistoryButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                searchHistory.clear();
                renderHistory();
            }
        });

        // Initial state
        renderHistory();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    /**
     * Perform search from button click — adds to history.
     */
    private void performSearch() {
        String query = searchInput.getText().toString().trim();
        if (query.isEmpty()) {
            Toast.makeText(this, getString(R.string.search_empty_hint), Toast.LENGTH_SHORT).show();
            return;
        }
        addToHistory(query);
        performSearchInternal(query, true);
    }

    /**
     * Internal search — filters exhibitions and users, updates UI.
     * @param query the search term
     * @param fromHistory whether this was triggered from history click (no history re-add)
     */
    private void performSearchInternal(String query, boolean fromHistory) {
        List<ExhibitorExhibition> exhibitions = ExhibitionManager.search(query);
        List<AdminUser> users = AdminUserManager.search(query);

        int total = exhibitions.size() + users.size();
        resultsCount.setVisibility(View.VISIBLE);
        resultsCount.setText(getString(R.string.search_results_count, total, query));

        resultsList.removeAllViews();

        if (total == 0) {
            showEmptyResults(query);
            return;
        }

        // Exhibition results section
        if (!exhibitions.isEmpty()) {
            addSectionHeader(resultsList, getString(R.string.search_section_exhibitions, exhibitions.size()));
            for (ExhibitorExhibition ex : exhibitions) {
                resultsList.addView(createExhibitionCard(ex), fullWidthParams(8));
            }
        }

        // User results section
        if (!users.isEmpty()) {
            addSectionHeader(resultsList, getString(R.string.search_section_users, users.size()));
            for (AdminUser user : users) {
                resultsList.addView(createUserCard(user), fullWidthParams(8));
            }
        }
    }

    /**
     * Show empty state when no results found.
     */
    private void showEmptyResults(String query) {
        LinearLayout emptyBox = new LinearLayout(this);
        emptyBox.setOrientation(LinearLayout.VERTICAL);
        emptyBox.setGravity(Gravity.CENTER);
        emptyBox.setPadding(dp(16), dp(48), dp(16), dp(48));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        emptyBox.setBackground(bg);

        TextView icon = new TextView(this);
        icon.setText("\uD83D\uDD0D");
        icon.setTextSize(36);
        icon.setGravity(Gravity.CENTER);
        emptyBox.addView(icon, fullWidthParams(0));

        TextView msg = new TextView(this);
        msg.setText(getString(R.string.search_no_results, query));
        msg.setTextColor(getResources().getColor(R.color.empty_icon_color));
        msg.setTextSize(14);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, dp(8), 0, 0);
        emptyBox.addView(msg, fullWidthParams(4));

        resultsList.addView(emptyBox, fullWidthParams(8));
    }

    /**
     * Clear results display.
     */
    private void clearResults() {
        resultsList.removeAllViews();
        resultsCount.setVisibility(View.GONE);
    }

    // ── Exhibition result card ──────────────────────────────────────

    private LinearLayout createExhibitionCard(ExhibitorExhibition ex) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        styleCard(card);

        addText(card, ex.getTitle(), R.color.text_primary, 16, Typeface.BOLD);
        addText(card, ex.getVenue() + " · " + ex.getCategory(), R.color.text_secondary, 14, Typeface.NORMAL);
        addText(card, getString(R.string.exhibitor_day_label, ex.getDay()) + " " + ex.getTime(),
                R.color.text_secondary, 13, Typeface.NORMAL);
        addText(card, ex.getStatus(),
                ex.isOpenForRegistration() ? R.color.status_open : R.color.status_closed,
                13, Typeface.BOLD);

        return card;
    }

    // ── User result card ────────────────────────────────────────────

    private LinearLayout createUserCard(AdminUser user) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        styleCard(card);

        addText(card, user.getNickname(), R.color.text_primary, 16, Typeface.BOLD);
        addText(card, user.getEmail(), R.color.text_secondary, 14, Typeface.NORMAL);
        addText(card, getString(R.string.admin_user_status_label, user.getStatus()),
                user.isActive() ? R.color.status_open
                        : user.isBanned() ? R.color.status_closed : R.color.status_pending,
                13, Typeface.BOLD);

        return card;
    }

    // ── Search history ──────────────────────────────────────────────

    private void addToHistory(String query) {
        // Remove if already exists (move to front)
        searchHistory.remove(query);
        // Add to front
        searchHistory.add(0, query);
        // Trim to max
        while (searchHistory.size() > MAX_HISTORY) {
            searchHistory.remove(searchHistory.size() - 1);
        }
        renderHistory();
    }

    private void renderHistory() {
        searchHistoryList.removeAllViews();

        if (searchHistory.isEmpty()) {
            searchHistorySection.setVisibility(View.GONE);
            return;
        }

        searchHistorySection.setVisibility(View.VISIBLE);

        for (final String term : searchHistory) {
            Button chip = new Button(this);
            chip.setAllCaps(false);
            chip.setText(term);
            chip.setTextSize(12);
            chip.setPadding(dp(12), dp(4), dp(12), dp(4));

            GradientDrawable chipBg = new GradientDrawable();
            chipBg.setColor(getResources().getColor(R.color.date_active_background));
            chipBg.setCornerRadius(dp(16));
            chipBg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
            chip.setBackground(chipBg);

            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    searchInput.setText(term);
                    searchInput.setSelection(term.length());
                    addToHistory(term);
                    performSearchInternal(term, true);
                }
            });

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            params.setMargins(0, 0, dp(8), dp(4));
            searchHistoryList.addView(chip, params);
        }
    }

    private void showHistory() {
        renderHistory();
    }

    // ── UI helpers ──────────────────────────────────────────────────

    private void addSectionHeader(LinearLayout parent, String title) {
        TextView header = new TextView(this);
        header.setText(title);
        header.setTextColor(getResources().getColor(R.color.text_primary));
        header.setTextSize(15);
        header.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.setPadding(0, dp(12), 0, dp(4));
        parent.addView(header, fullWidthParams(0));
    }

    private void styleCard(LinearLayout card) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        card.setBackground(bg);
        card.setElevation(dp(2));
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
}
