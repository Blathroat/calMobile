package com.example.calmobile;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

/**
 * Unit tests for {@link ExportManager}.
 * Tests the CSV escaping logic (package-private {@code escapeCsv} method).
 * <p>
 * Note: The static export methods ({@code exportExhibitions}, {@code exportRegistrations},
 * {@code exportUsers}) require an Android Context and depend on manager singletons,
 * so they cannot be tested with plain JUnit. Only the pure-Java CSV escaping logic is tested here.
 */
public class ExportManagerTest {

    // ── escapeCsv: null handling ──────────────────────────────────

    @Test
    public void escapeCsvNullReturnsEmpty() {
        assertEquals("", ExportManager.escapeCsv(null));
    }

    // ── escapeCsv: plain strings ──────────────────────────────────

    @Test
    public void escapeCsvPlainString() {
        assertEquals("hello", ExportManager.escapeCsv("hello"));
    }

    @Test
    public void escapeCsvEmptyString() {
        assertEquals("", ExportManager.escapeCsv(""));
    }

    @Test
    public void escapeCsvNumericString() {
        assertEquals("12345", ExportManager.escapeCsv("12345"));
    }

    @Test
    public void escapeCsvWithSpaces() {
        assertEquals("hello world", ExportManager.escapeCsv("hello world"));
    }

    // ── escapeCsv: comma handling ─────────────────────────────────

    @Test
    public void escapeCsvWithComma() {
        assertEquals("\"hello,world\"", ExportManager.escapeCsv("hello,world"));
    }

    @Test
    public void escapeCsvWithMultipleCommas() {
        assertEquals("\"a,b,c\"", ExportManager.escapeCsv("a,b,c"));
    }

    // ── escapeCsv: quote handling ─────────────────────────────────

    @Test
    public void escapeCsvWithDoubleQuote() {
        assertEquals("\"say \"\"hello\"\"\"", ExportManager.escapeCsv("say \"hello\""));
    }

    @Test
    public void escapeCsvWithMultipleQuotes() {
        assertEquals("\"\"\"a\"\"b\"\"c\"\"\"", ExportManager.escapeCsv("\"a\"b\"c\""));
    }

    // ── escapeCsv: newline handling ───────────────────────────────

    @Test
    public void escapeCsvWithNewline() {
        assertEquals("\"line1\nline2\"", ExportManager.escapeCsv("line1\nline2"));
    }

    @Test
    public void escapeCsvWithCarriageReturn() {
        // \r alone does not trigger quoting (only \n is checked)
        assertEquals("line1\rline2", ExportManager.escapeCsv("line1\rline2"));
    }

    // ── escapeCsv: combined special characters ────────────────────

    @Test
    public void escapeCsvWithCommaAndQuote() {
        assertEquals("\"say \"\"hi\"\", bye\"", ExportManager.escapeCsv("say \"hi\", bye"));
    }

    @Test
    public void escapeCsvWithCommaAndNewline() {
        assertEquals("\"a,\nb\"", ExportManager.escapeCsv("a,\nb"));
    }

    @Test
    public void escapeCsvWithAllSpecialChars() {
        String input = "a,\"b\"\nc";
        String expected = "\"a,\"\"b\"\"\nc\"";
        assertEquals(expected, ExportManager.escapeCsv(input));
    }

    // ── escapeCsv: Chinese characters ─────────────────────────────

    @Test
    public void escapeCsvChineseCharacters() {
        assertEquals("展会名称", ExportManager.escapeCsv("展会名称"));
    }

    @Test
    public void escapeCsvChineseWithComma() {
        assertEquals("\"广州,深圳\"", ExportManager.escapeCsv("广州,深圳"));
    }

    // ── escapeCsv: boundary values ────────────────────────────────

    @Test
    public void escapeCsvSingleComma() {
        assertEquals("\",\"", ExportManager.escapeCsv(","));
    }

    @Test
    public void escapeCsvSingleQuote() {
        assertEquals("\"\"\"\"", ExportManager.escapeCsv("\""));
    }

    @Test
    public void escapeCsvSingleNewline() {
        assertEquals("\"\n\"", ExportManager.escapeCsv("\n"));
    }

    @Test
    public void escapeCsvWhitespaceOnly() {
        assertEquals("   ", ExportManager.escapeCsv("   "));
    }

    @Test
    public void escapeCsvTabCharacter() {
        // Tab does not trigger quoting
        assertEquals("a\tb", ExportManager.escapeCsv("a\tb"));
    }
}
