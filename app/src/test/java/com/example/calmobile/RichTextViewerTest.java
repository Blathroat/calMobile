package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * Unit tests for RichTextViewer pure-Java logic (containsHtml, extractAttr).
 * Tests that depend on Android framework classes (parseHtml with SpannableStringBuilder)
 * are not included here — they require instrumented tests or Robolectric.
 */
public class RichTextViewerTest {

    // --- containsHtml ---

    @Test
    public void containsHtmlReturnsFalseForPlainText() {
        assertFalse(RichTextViewer.containsHtml("这是一段纯文本描述。"));
    }

    @Test
    public void containsHtmlReturnsFalseForEmptyString() {
        assertFalse(RichTextViewer.containsHtml(""));
    }

    @Test
    public void containsHtmlDetectsBoldTag() {
        assertTrue(RichTextViewer.containsHtml("<b>加粗文字</b>"));
    }

    @Test
    public void containsHtmlDetectsItalicTag() {
        assertTrue(RichTextViewer.containsHtml("<i>斜体文字</i>"));
    }

    @Test
    public void containsHtmlDetectsUnderlineTag() {
        assertTrue(RichTextViewer.containsHtml("<u>下划线</u>"));
    }

    @Test
    public void containsHtmlDetectsListTags() {
        assertTrue(RichTextViewer.containsHtml("<ul><li>项目一</li></ul>"));
    }

    @Test
    public void containsHtmlDetectsLinkTag() {
        assertTrue(RichTextViewer.containsHtml("<a href=\"https://example.com\">链接</a>"));
    }

    @Test
    public void containsHtmlDetectsBreakTag() {
        assertTrue(RichTextViewer.containsHtml("第一行<br>第二行"));
    }

    @Test
    public void containsHtmlDetectsBreakSlashTag() {
        assertTrue(RichTextViewer.containsHtml("第一行<br/>第二行"));
    }

    @Test
    public void containsHtmlDetectsBreakSpaceSlashTag() {
        assertTrue(RichTextViewer.containsHtml("第一行<br />第二行"));
    }

    @Test
    public void containsHtmlDetectsParagraphTag() {
        assertTrue(RichTextViewer.containsHtml("<p>段落内容</p>"));
    }

    @Test
    public void containsHtmlDetectsH3Tag() {
        assertTrue(RichTextViewer.containsHtml("<h3>标题</h3>"));
    }

    @Test
    public void containsHtmlIsCaseInsensitive() {
        assertTrue(RichTextViewer.containsHtml("<B>大写标签</B>"));
        assertTrue(RichTextViewer.containsHtml("<I>斜体</I>"));
        assertTrue(RichTextViewer.containsHtml("<U>下划线</U>"));
    }

    @Test
    public void containsHtmlReturnsFalseForAngleBracketsInText() {
        assertFalse(RichTextViewer.containsHtml("3 < 5 and 5 > 3"));
    }

    @Test
    public void containsHtmlDetectsComplexRichText() {
        String html = "<b>标题</b><br>描述<i>斜体</i>内容<ul><li>条目一</li><li>条目二</li></ul>";
        assertTrue(RichTextViewer.containsHtml(html));
    }

    @Test
    public void containsHtmlDetectsLinkWithHref() {
        // The containsHtml method checks for "<a " + "href"
        assertTrue(RichTextViewer.containsHtml("<a href=\"url\">text</a>"));
    }

    // --- extractAttr ---

    @Test
    public void extractAttrGetsDoubleQuotedValue() {
        String tag = "<a href=\"https://example.com\">";
        assertEquals("https://example.com", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrGetsSingleQuotedValue() {
        String tag = "<a href='https://example.com'>";
        assertEquals("https://example.com", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrGetsUnquotedValue() {
        String tag = "<a href=https://example.com>";
        assertEquals("https://example.com", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrReturnsNullWhenMissing() {
        String tag = "<a>";
        assertNull(RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrHandlesValueWithSpaces() {
        String tag = "<a href=\"https://example.com/path?a=1&b=2\">";
        assertEquals("https://example.com/path?a=1&b=2", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrHandlesEmptyValue() {
        String tag = "<a href=\"\">";
        assertEquals("", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrGetsUnquotedValueEndAtGt() {
        String tag = "<a href=https://example.com class=\"link\">";
        assertEquals("https://example.com", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrCaseInsensitive() {
        String tag = "<a HREF=\"https://example.com\">";
        assertEquals("https://example.com", RichTextViewer.extractAttr(tag, "href"));
    }

    @Test
    public void extractAttrHandlesChineseUrl() {
        String tag = "<a href=\"https://example.com/展会\">";
        assertEquals("https://example.com/展会", RichTextViewer.extractAttr(tag, "href"));
    }
}
