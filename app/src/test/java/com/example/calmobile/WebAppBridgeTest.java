package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

/**
 * 桥接入参解析：前端传来的 JSON 会变成 `Map<String, Object>`，
 * 这里钉住各种类型（数字是 Double、列表、嵌套对象）的取值规则与兜底行为。
 */
public class WebAppBridgeTest {

    private static Map<String, Object> payload() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "智能家居展");
        payload.put("empty", "");
        payload.put("blank", "   ");
        payload.put("count", 8.5D);
        payload.put("numericText", "12");
        payload.put("enabled", Boolean.TRUE);
        payload.put("disabled", Boolean.FALSE);
        payload.put("rows", Arrays.asList("a", "b"));
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("imageCount", 6.0D);
        payload.put("media", nested);
        return payload;
    }

    @Test
    public void 文本为空或缺失时用默认值() {
        assertEquals("智能家居展", WebAppBridge.text(payload(), "title", "默认"));
        assertEquals("默认", WebAppBridge.text(payload(), "empty", "默认"));
        assertEquals("默认", WebAppBridge.text(payload(), "missing", "默认"));
        // 空白串不算空：原样返回（调用方要自己 trim 才需要 trim）
        assertEquals("   ", WebAppBridge.text(payload(), "blank", "默认"));
    }

    @Test
    public void 布尔值只认布尔与字符串_true() {
        assertTrue(WebAppBridge.flag(payload(), "enabled", false));
        assertFalse(WebAppBridge.flag(payload(), "disabled", true));
        assertTrue(WebAppBridge.flag(payload(), "missing", true));

        Map<String, Object> map = new LinkedHashMap<>();
        map.put("yes", "true");
        map.put("no", "false");
        map.put("one", "1");
        assertTrue(WebAppBridge.flag(map, "yes", false));
        assertFalse(WebAppBridge.flag(map, "no", true));
        // Boolean.parseBoolean 只认 "true"：数字 1 不算真，前端要发布尔而不是 1/0
        assertFalse(WebAppBridge.flag(map, "one", true));
    }

    @Test
    public void 数字接受小数与数字字符串并截断() {
        assertEquals(8, WebAppBridge.number(payload(), "count", 0));
        assertEquals(12, WebAppBridge.number(payload(), "numericText", 0));
        assertEquals(3, WebAppBridge.number(payload(), "missing", 3));
        // 取不到或不是数字时用默认值，不抛异常
        assertEquals(0, WebAppBridge.number(payload(), "media", 0));
        assertEquals(0, WebAppBridge.number(payload(), "title", 0));
    }

    @Test
    public void 列表不是列表时给空表() {
        assertEquals(2, WebAppBridge.list(payload(), "rows").size());
        assertTrue(WebAppBridge.list(payload(), "title").isEmpty());
        assertTrue(WebAppBridge.list(payload(), "missing").isEmpty());
    }

    @Test
    public void 嵌套对象取不到时给空表() {
        Map<String, Object> nested = WebAppBridge.map(payload(), "media");
        assertEquals(1, nested.size());
        assertEquals(6, WebAppBridge.number(nested, "imageCount", 0));

        assertTrue(WebAppBridge.map(payload(), "title").isEmpty());
        assertTrue(WebAppBridge.map(payload(), "missing").isEmpty());
        assertTrue(WebAppBridge.map(null, "media").isEmpty());
    }

    /**
     * 只实现「按文案失败」的回调，收到带码的失败时应当退化成按文案失败——
     * 这样新增错误码不会让既有实现（或第三方实现）漏掉回调、把 promise 挂死。
     */
    @Test
    public void 未实现带码失败的回调会退化成按文案失败() {
        final String[] received = new String[2];
        WebAppBridge.ResultCallback legacy = new WebAppBridge.ResultCallback() {
            @Override
            public void success(Object data) {
            }

            @Override
            public void failure(String message) {
                received[0] = "legacy";
                received[1] = message;
            }
        };
        legacy.failure(WebAppBridge.CODE_CANCELLED, "已取消选择");
        assertEquals("legacy", received[0]);
        assertEquals("已取消选择", received[1]);
    }

    /** 错误码是前后端约定的字面量，改名会让前端的取消静默分支失效，因此钉住。 */
    @Test
    public void 错误码字面量固定() {
        assertEquals("cancelled", WebAppBridge.CODE_CANCELLED);
        assertEquals("timeout", WebAppBridge.CODE_TIMEOUT);
    }
}
