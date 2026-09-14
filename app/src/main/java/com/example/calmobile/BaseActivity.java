package com.example.calmobile;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 基础 Activity，集中维护 newUI 的间距、卡片、按钮和页面动画。 */
public abstract class BaseActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AppSettings.applyWindowColors(this);
    }

    // ── 尺寸辅助 ──────────────────────────────────────────────

    /** 按当前屏幕密度把 dp 换算为像素。 */
    protected int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    // ── 布局参数辅助 ───────────────────────────────────────────

    /** 创建带顶部间距的全宽布局参数。 */
    protected LinearLayout.LayoutParams fullWidthParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    // ── 文本创建 ──────────────────────────────────────────────

    /** 创建并添加统一样式的文本控件。 */
    protected TextView addText(LinearLayout parent, String text, int colorRes, int sizeSp, int style) {
        TextView textView = new TextView(this);
        textView.setText(text);
        textView.setTextColor(getResources().getColor(colorRes));
        textView.setTextSize(sizeSp);
        textView.setTypeface(Typeface.DEFAULT, style);
        textView.setLineSpacing(0, 1.3f);
        parent.addView(textView, fullWidthParams(6));
        return textView;
    }

    /** 创建带文字、底色和描边的状态标签，避免仅依赖颜色表达状态。 */
    protected TextView createStatusBadge(String text, boolean positive) {
        TextView badge = new TextView(this);
        badge.setText(text);
        badge.setTextSize(12);
        badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        badge.setGravity(android.view.Gravity.CENTER);
        badge.setIncludeFontPadding(false);
        badge.setPadding(dp(9), dp(6), dp(9), dp(6));
        badge.setTextColor(getResources().getColor(positive
                ? R.color.status_open : R.color.status_closed));
        badge.setBackgroundResource(positive
                ? R.drawable.bg_status_badge : R.drawable.bg_status_badge_closed);
        badge.setContentDescription("状态：" + text);
        return badge;
    }

    // ── 卡片样式 ───────────────────────────────────────────────────────

    /** 按设计令牌设置卡片背景、圆角和描边。 */
    protected void styleCard(LinearLayout card) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        card.setBackground(bg);
        card.setElevation(0);
        card.setClipToOutline(true);
    }

    // ── 面板动画 ───────────────────────────────────────────────

    /** 以淡入和上移效果显示面板。 */
    protected void animateShowPanel(final View panel) {
        panel.setVisibility(View.VISIBLE);
        panel.setAlpha(0f);
        panel.setTranslationY(dp(16));
        panel.animate()
                .alpha(1f)
                .translationY(0)
                .setDuration(300)
                .setInterpolator(new DecelerateInterpolator())
                .setListener(null)
                .start();
    }

    /** 以淡出和下移效果隐藏面板，结束后设为 GONE。 */
    protected void animateHidePanel(final View panel) {
        panel.animate()
                .alpha(0f)
                .translationY(dp(8))
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

    // ── 列表动画 ────────────────────────────────────────────────

    /** 让列表子项按顺序淡入并上移。 */
    protected void animateListItems(LinearLayout container, int startDelay) {
        for (int i = 0; i < container.getChildCount(); i++) {
            View child = container.getChildAt(i);
            child.setAlpha(0f);
            child.setTranslationY(dp(12));
            child.animate()
                    .alpha(1f)
                    .translationY(0)
                    .setDuration(280)
                    .setStartDelay(startDelay + i * 50)
                    .setInterpolator(new DecelerateInterpolator())
                    .start();
        }
    }

    // ── 空状态 ────────────────────────────────────────────────────

    /** 在容器中显示带提示文案的空状态卡片。 */
    protected void showEmptyState(LinearLayout container, String message) {
        container.removeAllViews();

        LinearLayout emptyBox = new LinearLayout(this);
        emptyBox.setOrientation(LinearLayout.VERTICAL);
        emptyBox.setGravity(android.view.Gravity.CENTER);
        emptyBox.setPadding(dp(24), dp(40), dp(24), dp(40));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        emptyBox.setBackground(bg);

        // 使用低对比度标记，避免空状态引入无关图标。
        TextView icon = new TextView(this);
        icon.setText(getString(R.string.empty_state_icon));
        icon.setTextSize(40);
        icon.setGravity(android.view.Gravity.CENTER);

        GradientDrawable iconBg = new GradientDrawable();
        iconBg.setShape(GradientDrawable.OVAL);
        iconBg.setColor(getResources().getColor(R.color.primary_container));
        icon.setBackground(iconBg);
        icon.setPadding(dp(16), dp(16), dp(16), dp(16));

        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(72), dp(72));
        iconParams.gravity = android.view.Gravity.CENTER;
        emptyBox.addView(icon, iconParams);

        TextView msg = new TextView(this);
        msg.setText(message);
        msg.setTextColor(getResources().getColor(R.color.text_tertiary));
        msg.setTextSize(14);
        msg.setGravity(android.view.Gravity.CENTER);
        msg.setPadding(0, dp(16), 0, 0);
        msg.setLineSpacing(0, 1.3f);
        emptyBox.addView(msg, fullWidthParams(4));

        container.addView(emptyBox, fullWidthParams(8));
    }

    // ── 确认操作 ────────────────────────────────────────────────

    /** 显示带确定和取消按钮的确认对话框。 */
    protected void showConfirmDialog(String message, final Runnable onConfirm) {
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

    // ── Button styling ─────────────────────────────────────────────────

    /**
     * 应用深石墨实心主按钮样式。
     *
     * @param btn 要设置样式的按钮
     */
    protected void stylePrimaryButton(android.widget.Button btn) {
        btn.setBackgroundResource(R.drawable.bg_button_primary);
        btn.setBackgroundTintList(android.content.res.ColorStateList.valueOf(
                AppSettings.getAccentColor(this)));
        btn.setTextColor(getResources().getColor(R.color.button_primary_text));
        btn.setAllCaps(false);
        btn.setStateListAnimator(null);
        btn.setElevation(0);
        btn.setTextSize(14);
        btn.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        btn.setMinHeight(dp(48));
        btn.setMinimumHeight(dp(48));
        btn.setPadding(dp(16), 0, dp(16), 0);
    }

    /**
     * 应用白底描边次按钮样式。
     *
     * @param btn 要设置样式的按钮
     */
    protected void styleSecondaryButton(android.widget.Button btn) {
        btn.setBackgroundResource(R.drawable.bg_button_secondary);
        btn.setTextColor(getResources().getColor(R.color.button_secondary_text));
        btn.setAllCaps(false);
        btn.setStateListAnimator(null);
        btn.setElevation(0);
        btn.setTextSize(14);
        btn.setMinHeight(dp(44));
        btn.setMinimumHeight(dp(44));
        btn.setPadding(dp(14), 0, dp(14), 0);
    }

    /** 设置浅橙危险操作按钮样式。 */
    protected void styleDangerButton(android.widget.Button btn) {
        btn.setBackgroundResource(R.drawable.bg_button_danger);
        btn.setTextColor(getResources().getColor(R.color.button_danger_text));
        btn.setAllCaps(false);
        btn.setStateListAnimator(null);
        btn.setElevation(0);
        btn.setTextSize(14);
        btn.setMinHeight(dp(44));
        btn.setMinimumHeight(dp(44));
        btn.setPadding(dp(14), 0, dp(14), 0);
    }

    /** 为代码动态创建的输入框补齐可见描边和上下内边距。 */
    protected void styleInputField(android.widget.EditText input) {
        input.setBackgroundResource(R.drawable.bg_input_field);
        input.setTextColor(getResources().getColor(R.color.text_primary));
        input.setHintTextColor(getResources().getColor(R.color.text_hint));
        input.setTextSize(15);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setMinHeight(dp(48));
        input.setMinimumHeight(dp(48));
        input.setIncludeFontPadding(false);
    }

    /** 为内嵌选择栏设置统一的灰底、描边和触摸反馈。 */
    protected void stylePickerField(TextView field) {
        field.setBackgroundResource(R.drawable.bg_picker_field);
        field.setTextColor(getResources().getColor(R.color.text_primary));
        field.setTextSize(15);
        field.setGravity(android.view.Gravity.CENTER_VERTICAL);
        field.setMinHeight(dp(48));
        field.setMinimumHeight(dp(48));
        field.setPadding(dp(14), 0, dp(14), 0);
        field.setClickable(true);
        field.setFocusable(true);
    }

    /** 设置退出登录按钮样式。 */
    protected void styleLogoutButton(android.widget.Button btn) {
        btn.setBackgroundResource(R.drawable.bg_button_text);
        btn.setTextColor(getResources().getColor(R.color.status_closed));
        btn.setTextSize(15);
        btn.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        btn.setAllCaps(false);
        btn.setStateListAnimator(null);
        btn.setElevation(0);
    }

    // ── 返回按钮样式 ────────────────────────────────────────────

    /** 为返回控件设置透明触摸反馈。 */
    protected void applyRippleToBackButton(TextView btn) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(8));
        shape.setColor(Color.TRANSPARENT);

        RippleDrawable ripple = new RippleDrawable(
                android.content.res.ColorStateList.valueOf(getResources().getColor(R.color.ripple_light)),
                shape, null);
        btn.setBackground(ripple);
        btn.setTextColor(getResources().getColor(R.color.primary));
        btn.setPadding(dp(10), dp(8), dp(10), dp(8));
        btn.setMinHeight(dp(44));
        btn.setMinimumHeight(dp(44));
    }

    // ── 分隔线 ────────────────────────────────────────────────────────

    /** 向容器添加一条水平分隔线。 */
    protected void addDivider(LinearLayout parent) {
        View divider = new View(this);
        divider.setBackgroundColor(getResources().getColor(R.color.divider_color));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1));
        params.setMargins(0, dp(12), 0, dp(4));
        parent.addView(divider, params);
    }

    // ── 导航辅助 ─────────────────────────────────────────────

    /** 以统一滑动动画打开目标页面。 */
    protected void navigateTo(Class<? extends Activity> activityClass) {
        startActivity(new Intent(this, activityClass));
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
    }

    /** 使用已有 Intent 并应用统一滑动动画。 */
    protected void navigateTo(Intent intent) {
        startActivity(intent);
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
    }
}
