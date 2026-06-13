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
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Base Activity class providing common UI helper methods shared across
 * all Activities in the calMobile application.
 *
 * <p>Subclasses inherit reusable helpers for:
 * <ul>
 *   <li>Dimension conversion ({@link #dp(int)})</li>
 *   <li>Layout parameter creation ({@link #fullWidthParams(int)})</li>
 *   <li>TextView creation ({@link #addText(LinearLayout, String, int, int, int)})</li>
 *   <li>Card styling ({@link #styleCard(LinearLayout)})</li>
 *   <li>Panel animations ({@link #animateShowPanel(View)}, {@link #animateHidePanel(View)})</li>
 *   <li>List item animations ({@link #animateListItems(LinearLayout, int)})</li>
 *   <li>Empty state display ({@link #showEmptyState(LinearLayout, String)})</li>
 *   <li>Confirmation dialogs ({@link #showConfirmDialog(String, Runnable)})</li>
 *   <li>Back button styling ({@link #applyRippleToBackButton(TextView)})</li>
 *   <li>Divider creation ({@link #addDivider(LinearLayout)})</li>
 *   <li>Navigation helpers ({@link #navigateTo(Class)}, {@link #navigateTo(Intent)})</li>
 * </ul>
 */
public abstract class BaseActivity extends Activity {

    // ── Dimension helpers ──────────────────────────────────────────────

    /**
     * Convert a dp value to pixels based on the current display density.
     *
     * @param value the dp value to convert
     * @return the equivalent pixel value
     */
    protected int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    // ── Layout parameter helpers ───────────────────────────────────────

    /**
     * Create full-width LinearLayout.LayoutParams with a top margin.
     *
     * @param topMarginDp top margin in dp
     * @return LayoutParams for a full-width view with the specified top margin
     */
    protected LinearLayout.LayoutParams fullWidthParams(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(topMarginDp), 0, 0);
        return params;
    }

    // ── TextView creation ──────────────────────────────────────────────

    /**
     * Create and add a styled TextView to a parent LinearLayout.
     *
     * @param parent   the container to add the TextView to
     * @param text     the text content
     * @param colorRes the color resource ID for the text color
     * @param sizeSp   the text size in sp
     * @param style    the Typeface style constant (e.g. {@link Typeface#BOLD})
     * @return the created TextView
     */
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

    // ── Card styling ───────────────────────────────────────────────────

    /**
     * Apply the standard card background, corner radius, stroke, and elevation
     * to a LinearLayout using the design system values.
     *
     * @param card the LinearLayout to style
     */
    protected void styleCard(LinearLayout card) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(getResources().getColor(R.color.card_background));
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), getResources().getColor(R.color.card_stroke));
        card.setBackground(bg);
        card.setElevation(dp(2));
        card.setClipToOutline(true);
    }

    // ── Panel animations ───────────────────────────────────────────────

    /**
     * Animate a panel into view with a fade-in and slide-up effect.
     *
     * @param panel the View to animate in
     */
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

    /**
     * Animate a panel out of view with a fade-out and slide-down effect,
     * then set its visibility to {@link View#GONE}.
     *
     * @param panel the View to animate out
     */
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

    // ── List animations ────────────────────────────────────────────────

    /**
     * Animate child views of a LinearLayout with a staggered fade-in and
     * slide-up effect.
     *
     * @param container  the LinearLayout whose children to animate
     * @param startDelay the initial delay in milliseconds before animation starts
     */
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

    // ── Empty state ────────────────────────────────────────────────────

    /**
     * Display an empty state placeholder inside a LinearLayout container.
     * Shows an icon and a message centered in a styled card.
     *
     * @param container the LinearLayout to populate with the empty state
     * @param message   the message to display
     */
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

        // Icon with subtle background circle
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

    // ── Confirmation dialog ────────────────────────────────────────────

    /**
     * Show a confirmation dialog with Yes/No buttons.
     *
     * @param message    the confirmation message to display
     * @param onConfirm  the action to execute when the user confirms
     */
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

    // ── Back button styling ────────────────────────────────────────────

    /**
     * Apply a ripple background effect to a back button TextView.
     *
     * @param btn the TextView to style as a back button
     */
    protected void applyRippleToBackButton(TextView btn) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(20));
        shape.setColor(Color.TRANSPARENT);

        RippleDrawable ripple = new RippleDrawable(
                android.content.res.ColorStateList.valueOf(getResources().getColor(R.color.ripple_light)),
                shape, null);
        btn.setBackground(ripple);
        btn.setTextColor(getResources().getColor(R.color.primary));
        btn.setPadding(dp(14), dp(8), dp(14), dp(8));
    }

    // ── Divider ────────────────────────────────────────────────────────

    /**
     * Add a horizontal divider line to a parent LinearLayout.
     *
     * @param parent the LinearLayout to add the divider to
     */
    protected void addDivider(LinearLayout parent) {
        View divider = new View(this);
        divider.setBackgroundColor(getResources().getColor(R.color.divider_color));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1));
        params.setMargins(0, dp(12), 0, dp(4));
        parent.addView(divider, params);
    }

    // ── Navigation helpers ─────────────────────────────────────────────

    /**
     * Navigate to another Activity with a slide-in transition.
     *
     * @param activityClass the target Activity class
     */
    protected void navigateTo(Class<? extends Activity> activityClass) {
        startActivity(new Intent(this, activityClass));
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
    }

    /**
     * Navigate using a pre-built Intent with a slide-in transition.
     *
     * @param intent the Intent to start the target Activity
     */
    protected void navigateTo(Intent intent) {
        startActivity(intent);
        overridePendingTransition(R.anim.slide_in_right, R.anim.slide_out_left);
    }
}
