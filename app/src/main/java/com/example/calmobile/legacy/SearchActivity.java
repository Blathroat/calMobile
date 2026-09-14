package com.example.calmobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.inputmethod.EditorInfo;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** 统一搜索展会与用户，支持实时筛选和最近十条本地历史记录。 */
public class SearchActivity extends BaseActivity {

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

        // 初始化数据管理器
        ExhibitionManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        // 绑定界面控件
        searchInput = findViewById(R.id.search_input);
        searchButton = findViewById(R.id.search_btn);
        searchHistorySection = findViewById(R.id.search_history_section);
        searchHistoryList = findViewById(R.id.search_history_list);
        clearHistoryButton = findViewById(R.id.search_clear_history_btn);
        resultsCount = findViewById(R.id.search_results_count);
        resultsList = findViewById(R.id.search_results_list);

        // 返回按钮
        Button backButton = findViewById(R.id.search_back_btn);
        backButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        // 搜索按钮
        searchButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                performSearch();
            }
        });

        // 输入时即时筛选结果
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

        searchInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                performSearch();
                return true;
            }
            return false;
        });

        // 清空历史记录
        clearHistoryButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                searchHistory.clear();
                renderHistory();
            }
        });

        // 初始状态
        renderHistory();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(R.anim.slide_in_left, R.anim.slide_out_right);
    }

    /** 从按钮或软键盘提交搜索，并记录关键词。 */
    private void performSearch() {
        String query = searchInput.getText().toString().trim();
        if (query.isEmpty()) {
            Toast.makeText(this, getString(R.string.search_empty_hint), Toast.LENGTH_SHORT).show();
            return;
        }
        addToHistory(query);
        performSearchInternal(query, true);
    }

    /** 筛选展会和用户，并刷新结果区域。 */
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

        // 展会结果区域
        if (!exhibitions.isEmpty()) {
            addSectionHeader(resultsList, getString(R.string.search_section_exhibitions, exhibitions.size()));
            for (ExhibitorExhibition ex : exhibitions) {
                resultsList.addView(createExhibitionCard(ex), fullWidthParams(8));
            }
        }

        // 用户结果区域
        if (!users.isEmpty()) {
            addSectionHeader(resultsList, getString(R.string.search_section_users, users.size()));
            for (AdminUser user : users) {
                resultsList.addView(createUserCard(user), fullWidthParams(8));
            }
        }
    }

    /** 没有结果时显示空状态。 */
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
        icon.setText("⌕");
        icon.setTextColor(getResources().getColor(R.color.text_tertiary));
        icon.setTextSize(30);
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

    /** 清空搜索结果。 */
    private void clearResults() {
        resultsList.removeAllViews();
        resultsCount.setVisibility(View.GONE);
    }

    // ── 展会结果卡片 ─────────────────────────────────────────────

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

        card.setOnClickListener(v -> {
            Intent intent = new Intent(SearchActivity.this, ExhibitionDetailActivity.class);
            intent.putExtra(ExhibitionDetailActivity.EXTRA_EXHIBITION_ID, ex.getId());
            intent.putExtra("day", ex.getDay());
            intent.putExtra("month", 6);
            intent.putExtra("title", ex.getTitle());
            intent.putExtra("venue", ex.getVenue());
            intent.putExtra("time", ex.getTime());
            intent.putExtra("status", ex.getStatus());
            intent.putExtra("openForRegistration", ex.isOpenForRegistration());
            intent.putExtra("description", ex.getDescription());
            intent.putExtra("category", ex.getCategory());
            navigateTo(intent);
        });

        return card;
    }

    // ── 用户结果卡片 ─────────────────────────────────────────────

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

        card.setOnClickListener(v -> {
            Intent intent = new Intent(SearchActivity.this, UserPublicActivity.class);
            intent.putExtra("nickname", user.getNickname());
            intent.putExtra("contact", user.getEmail());
            intent.putExtra("bio", getString(R.string.user_public_no_info));
            intent.putExtra("showRegistrations", false);
            intent.putExtra("isOwnProfile", false);
            navigateTo(intent);
        });

        return card;
    }

    // ── 搜索历史 ─────────────────────────────────────────────────

    private void addToHistory(String query) {
        searchHistory.remove(query);
        searchHistory.add(0, query);
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
            chip.setTextSize(13);
            chip.setPadding(dp(14), dp(6), dp(14), dp(6));
            chip.setTextColor(getResources().getColor(R.color.chip_text));

            GradientDrawable chipBg = new GradientDrawable();
            chipBg.setColor(getResources().getColor(R.color.chip_bg));
            chipBg.setCornerRadius(dp(100));
            chipBg.setStroke(dp(1), getResources().getColor(R.color.chip_border));
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

    // ── 界面辅助方法 ─────────────────────────────────────────────

    /** 向结果列表添加分组标题。 */
    private void addSectionHeader(LinearLayout parent, String title) {
        TextView header = new TextView(this);
        header.setText(title);
        header.setTextColor(getResources().getColor(R.color.text_primary));
        header.setTextSize(15);
        header.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.setPadding(0, dp(12), 0, dp(4));
        parent.addView(header, fullWidthParams(0));
    }
}
