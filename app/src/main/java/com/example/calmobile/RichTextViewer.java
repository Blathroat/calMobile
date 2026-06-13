package com.example.calmobile;

import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.method.LinkMovementMethod;
import android.text.style.BulletSpan;
import android.text.style.ClickableSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.StyleSpan;
import android.text.style.UnderlineSpan;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

/**
 * Lightweight rich text viewer that parses basic HTML tags into SpannableString.
 * Supported tags: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;ul&gt;, &lt;li&gt;, &lt;a&gt;, &lt;br&gt;, &lt;p&gt;, &lt;h3&gt;.
 * Falls back to plain text when no HTML tags are detected.
 *
 * <p>Usage:
 * <pre>
 *   RichTextViewer.setText(textView, htmlString, context);
 * </pre>
 *
 * <p>No external libraries or WebView required — uses only Android SDK spans.
 */
public final class RichTextViewer {

    private static final String[] HTML_TAGS = {
            "<b>", "</b>", "<i>", "</i>", "<u>", "</u>",
            "<ul>", "</ul>", "<li>", "</li>",
            "<a ", "</a>", "<br>", "<br/>", "<br />",
            "<p>", "</p>", "<h3>", "</h3>"
    };

    private RichTextViewer() {
        // Utility class — no instantiation
    }

    /**
     * Parse the input text and apply rich text formatting to the given TextView.
     * If the text contains no recognized HTML tags, it is set as plain text.
     *
     * @param textView the target TextView
     * @param text     raw text that may contain HTML tags
     * @param context  used for launching browser intents on link clicks
     */
    public static void setText(TextView textView, String text, Context context) {
        if (text == null || text.length() == 0) {
            textView.setText("");
            return;
        }

        if (!containsHtml(text)) {
            // Plain text fallback — no HTML detected
            textView.setText(text);
            return;
        }

        SpannableStringBuilder builder = parseHtml(text, context);
        textView.setText(builder);
        textView.setMovementMethod(LinkMovementMethod.getInstance());
    }

    /**
     * Check whether the text contains any recognized HTML tags.
     */
    static boolean containsHtml(String text) {
        String lower = text.toLowerCase();
        for (String tag : HTML_TAGS) {
            if (lower.contains(tag)) {
                return true;
            }
        }
        // Also check for <a with href (partial match)
        if (lower.contains("<a ") && lower.contains("href")) {
            return true;
        }
        return false;
    }

    /**
     * Parse HTML-like markup into a SpannableStringBuilder.
     */
    static SpannableStringBuilder parseHtml(String text, Context context) {
        SpannableStringBuilder builder = new SpannableStringBuilder();
        String lower = text.toLowerCase();

        int pos = 0;
        // Stack to track open formatting spans: each entry is [startIndex, tagType]
        // tagType: "b", "i", "u", "a", "h3"
        Stack<int[]> spanStack = new Stack<>();
        // Track link hrefs for nested <a> tags
        Stack<String> hrefStack = new Stack<>();
        boolean inList = false;
        boolean inListItem = false;

        while (pos < text.length()) {
            // Find next '<'
            int tagStart = text.indexOf('<', pos);
            if (tagStart == -1) {
                // No more tags — append remaining text
                builder.append(text.substring(pos));
                break;
            }

            // Append text before the tag
            if (tagStart > pos) {
                builder.append(text.substring(pos, tagStart));
            }

            // Find matching '>'
            int tagEnd = text.indexOf('>', tagStart);
            if (tagEnd == -1) {
                // Malformed — treat '<' as literal
                builder.append(text.substring(tagStart));
                break;
            }

            String tag = text.substring(tagStart, tagEnd + 1);
            String tagLower = tag.toLowerCase();

            if (tagLower.equals("<b>")) {
                spanStack.push(new int[]{builder.length(), 0}); // 0 = bold
            } else if (tagLower.equals("</b>")) {
                applySpan(builder, spanStack, 0, context, null);
            } else if (tagLower.equals("<i>")) {
                spanStack.push(new int[]{builder.length(), 1}); // 1 = italic
            } else if (tagLower.equals("</i>")) {
                applySpan(builder, spanStack, 1, context, null);
            } else if (tagLower.equals("<u>")) {
                spanStack.push(new int[]{builder.length(), 2}); // 2 = underline
            } else if (tagLower.equals("</u>")) {
                applySpan(builder, spanStack, 2, context, null);
            } else if (tagLower.startsWith("<a ") && tagLower.contains("href")) {
                // Extract href value
                String href = extractAttr(tag, "href");
                if (href == null) href = "";
                hrefStack.push(href);
                spanStack.push(new int[]{builder.length(), 3}); // 3 = link
            } else if (tagLower.equals("</a>")) {
                String href = hrefStack.isEmpty() ? "" : hrefStack.pop();
                applySpan(builder, spanStack, 3, context, href);
            } else if (tagLower.equals("<h3>")) {
                spanStack.push(new int[]{builder.length(), 4}); // 4 = h3
            } else if (tagLower.equals("</h3>")) {
                applySpan(builder, spanStack, 4, context, null);
            } else if (tagLower.equals("<br>") || tagLower.equals("<br/>") || tagLower.equals("<br />")) {
                builder.append("\n");
            } else if (tagLower.equals("<p>")) {
                // Add paragraph spacing if builder is non-empty
                if (builder.length() > 0 && builder.charAt(builder.length() - 1) != '\n') {
                    builder.append("\n");
                }
            } else if (tagLower.equals("</p>")) {
                builder.append("\n");
            } else if (tagLower.equals("<ul>")) {
                inList = true;
                if (builder.length() > 0 && builder.charAt(builder.length() - 1) != '\n') {
                    builder.append("\n");
                }
            } else if (tagLower.equals("</ul>")) {
                inList = false;
                if (builder.length() > 0 && builder.charAt(builder.length() - 1) != '\n') {
                    builder.append("\n");
                }
            } else if (tagLower.equals("<li>")) {
                inListItem = true;
                // Ensure newline before bullet
                if (builder.length() > 0 && builder.charAt(builder.length() - 1) != '\n') {
                    builder.append("\n");
                }
                spanStack.push(new int[]{builder.length(), 5}); // 5 = bullet
            } else if (tagLower.equals("</li>")) {
                inListItem = false;
                // Close bullet span
                applyBulletSpan(builder, spanStack);
            } else {
                // Unknown tag — append as literal
                builder.append(tag);
            }

            pos = tagEnd + 1;
        }

        // Close any unclosed spans
        closeUnclosedSpans(builder, spanStack, context, hrefStack);

        return builder;
    }

    /**
     * Extract an attribute value from a tag string.
     * Example: extractAttr("<a href=\"https://example.com\">", "href") → "https://example.com"
     */
    static String extractAttr(String tag, String attrName) {
        String lower = tag.toLowerCase();
        int attrIdx = lower.indexOf(attrName + "=");
        if (attrIdx == -1) return null;

        int valueStart = attrIdx + attrName.length() + 1;
        if (valueStart >= tag.length()) return null;

        char quote = tag.charAt(valueStart);
        if (quote == '"' || quote == '\'') {
            int valueEnd = tag.indexOf(quote, valueStart + 1);
            if (valueEnd == -1) return tag.substring(valueStart + 1);
            return tag.substring(valueStart + 1, valueEnd);
        } else {
            // Unquoted — read until space or '>'
            int valueEnd = valueStart;
            while (valueEnd < tag.length() && tag.charAt(valueEnd) != ' ' && tag.charAt(valueEnd) != '>') {
                valueEnd++;
            }
            return tag.substring(valueStart, valueEnd);
        }
    }

    /**
     * Apply a completed span from the stack for the given tag type.
     */
    private static void applySpan(SpannableStringBuilder builder, Stack<int[]> stack,
                                  int tagType, Context context, String href) {
        // Find matching open span on stack (search from top)
        for (int i = stack.size() - 1; i >= 0; i--) {
            if (stack.get(i)[1] == tagType) {
                int start = stack.get(i)[0];
                int end = builder.length();
                stack.remove(i);

                if (start < end) {
                    switch (tagType) {
                        case 0: // bold
                            builder.setSpan(new StyleSpan(Typeface.BOLD), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            break;
                        case 1: // italic
                            builder.setSpan(new StyleSpan(Typeface.ITALIC), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            break;
                        case 2: // underline
                            builder.setSpan(new UnderlineSpan(), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            break;
                        case 3: // link
                            if (context != null && href != null && href.length() > 0) {
                                builder.setSpan(new RichTextLinkSpan(href, context), start, end,
                                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                                // Also add a color so it looks like a link
                                builder.setSpan(new ForegroundColorSpan(0xFF1F8A5B), start, end,
                                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            }
                            break;
                        case 4: // h3
                            builder.setSpan(new StyleSpan(Typeface.BOLD), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            builder.setSpan(new RelativeSizeSpan(1.2f), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            break;
                    }
                }
                return;
            }
        }
    }

    /**
     * Apply a bullet span for <li> elements.
     */
    private static void applyBulletSpan(SpannableStringBuilder builder, Stack<int[]> stack) {
        for (int i = stack.size() - 1; i >= 0; i--) {
            if (stack.get(i)[1] == 5) { // 5 = bullet
                int start = stack.get(i)[0];
                int end = builder.length();
                stack.remove(i);

                if (start < end) {
                    builder.setSpan(new BulletSpan(20, 0xFF1F8A5B), start, end,
                            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                return;
            }
        }
    }

    /**
     * Close any unclosed spans still on the stack.
     */
    private static void closeUnclosedSpans(SpannableStringBuilder builder, Stack<int[]> stack,
                                           Context context, Stack<String> hrefStack) {
        // Process remaining spans in reverse order
        while (!stack.isEmpty()) {
            int[] entry = stack.pop();
            int start = entry[0];
            int end = builder.length();
            int tagType = entry[1];

            if (start < end) {
                switch (tagType) {
                    case 0:
                        builder.setSpan(new StyleSpan(Typeface.BOLD), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        break;
                    case 1:
                        builder.setSpan(new StyleSpan(Typeface.ITALIC), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        break;
                    case 2:
                        builder.setSpan(new UnderlineSpan(), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        break;
                    case 3:
                        String href = hrefStack.isEmpty() ? "" : hrefStack.pop();
                        if (context != null && href != null && href.length() > 0) {
                            builder.setSpan(new RichTextLinkSpan(href, context), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            builder.setSpan(new ForegroundColorSpan(0xFF1F8A5B), start, end,
                                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        }
                        break;
                    case 4:
                        builder.setSpan(new StyleSpan(Typeface.BOLD), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        builder.setSpan(new RelativeSizeSpan(1.2f), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        break;
                    case 5:
                        builder.setSpan(new BulletSpan(20, 0xFF1F8A5B), start, end,
                                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        break;
                }
            }
        }
    }

    /**
     * ClickableSpan that opens a URL in the browser or shows a toast on failure.
     */
    private static class RichTextLinkSpan extends ClickableSpan {
        private final String url;
        private final Context context;

        RichTextLinkSpan(String url, Context context) {
            this.url = url;
            this.context = context;
        }

        @Override
        public void onClick(View widget) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                context.startActivity(intent);
            } catch (Exception e) {
                Toast.makeText(context, "无法打开链接：" + url, Toast.LENGTH_SHORT).show();
            }
        }
    }
}
