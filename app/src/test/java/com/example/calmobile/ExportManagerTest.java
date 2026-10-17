package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/**
 * 导出 CSV：数据行由前端传进来（它已经从后端拿到数据），这里只测拼装与转义。
 */
public class ExportManagerTest {

    private static Map<String, Object> row(String id, String title, String venue, String description) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", id);
        row.put("title", title);
        row.put("venue", venue);
        row.put("date", "2026-09-25");
        row.put("time", "09:00-17:30");
        row.put("status", "报名中 · 无需审核");
        row.put("category", "智能家居");
        row.put("description", description);
        return row;
    }

    /** 没有数据时不生成文件。 */
    @Test
    public void returnsNullWhenThereAreNoRows() {
        assertNull(ExportManager.exhibitionsCsv(null));
        assertNull(ExportManager.exhibitionsCsv(new ArrayList<>()));
    }

    /** 第一行是表头，并且文件以 UTF-8 字节序标记开头。 */
    @Test
    public void startsWithBomAndHeaderRow() {
        String csv = ExportManager.exhibitionsCsv(Arrays.asList(row("exh-1", "智能家居展", "深圳", "简介")));
        assertTrue("应当以 UTF-8 BOM 开头，Excel 打开中文才不乱码", csv.startsWith("\uFEFF"));
        String[] lines = csv.split("\n");
        assertEquals(2, lines.length);
        assertTrue(lines[0].contains("展会名称"));
        assertTrue(lines[0].contains("展馆地点"));
        assertTrue(lines[0].contains("展会简介"));
    }

    /** 每一行数据按表头顺序落列。 */
    @Test
    public void writesColumnsInHeaderOrder() {
        String csv = ExportManager.exhibitionsCsv(Arrays.asList(row("exh-1", "智能家居展", "深圳会展中心", "简介")));
        String data = csv.split("\n")[1];
        assertEquals("exh-1,智能家居展,深圳会展中心,2026-09-25,09:00-17:30,报名中 · 无需审核,智能家居,简介", data);
    }

    /** 多条数据按传入顺序导出。 */
    @Test
    public void keepsInputOrder() {
        List<Map<String, Object>> rows = Arrays.asList(
                row("exh-1", "第一场", "A", ""),
                row("exh-2", "第二场", "B", ""));
        String csv = ExportManager.exhibitionsCsv(rows);
        String[] lines = csv.split("\n");
        assertEquals(3, lines.length);
        assertTrue(lines[1].startsWith("exh-1"));
        assertTrue(lines[2].startsWith("exh-2"));
    }

    /** 含逗号、引号或换行的字段会被转义。 */
    @Test
    public void escapesCommaQuoteAndNewlines() {
        assertEquals("\"a,b\"", ExportManager.escapeCsv("a,b"));
        assertEquals("\"say \"\"hi\"\"\"", ExportManager.escapeCsv("say \"hi\""));
        assertEquals("\"line1\nline2\"", ExportManager.escapeCsv("line1\nline2"));
        // \r（Windows 换行）不包引号会破坏行结构，把一条记录拆成两条
        assertEquals("\"line1\r\nline2\"", ExportManager.escapeCsv("line1\r\nline2"));
        assertEquals("\"carriage\rreturn\"", ExportManager.escapeCsv("carriage\rreturn"));
        assertEquals("plain", ExportManager.escapeCsv("plain"));
        assertEquals("", ExportManager.escapeCsv(null));
    }

    /** 缺失字段当成空串。 */
    @Test
    public void treatsMissingFieldsAsEmpty() {
        Map<String, Object> partial = new LinkedHashMap<>();
        partial.put("id", "exh-9");
        partial.put("title", "只有标题");
        String csv = ExportManager.exhibitionsCsv(Arrays.asList(partial));
        String data = csv.split("\n")[1];
        assertEquals("exh-9,只有标题,,,,,,", data);
    }

    /** 文件名带时间戳和 .csv 后缀。 */
    @Test
    public void includesTimestampAndCsvSuffix() {
        String name = ExportManager.fileName("calmobile-exhibitions");
        assertTrue(name.startsWith("calmobile-exhibitions_"));
        assertTrue(name.endsWith(".csv"));
    }

    /** 文本导出沿用同一套命名：前缀 + 时间戳 + 按 MIME 取的后缀。 */
    @Test
    public void namesTextExportByMimeType() {
        String name = ExportManager.fileName("calmobile-text", ExportManager.textExtension("application/json"));
        assertTrue(name.startsWith("calmobile-text_"));
        assertTrue(name.endsWith(".json"));
        assertEquals("json", ExportManager.textExtension("application/json"));
        assertEquals("json", ExportManager.textExtension("application/json; charset=utf-8"));
        assertEquals("txt", ExportManager.textExtension("text/plain"));
        assertEquals("txt", ExportManager.textExtension("application/octet-stream"));
        assertEquals("txt", ExportManager.textExtension(null));
    }
}
