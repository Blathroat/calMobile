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

    /** 文本为空或缺失时用默认值。纯空白仍原样返回。 */
    @Test
    public void usesDefaultWhenTextIsEmptyOrMissing() {
        assertEquals("智能家居展", WebAppBridge.text(payload(), "title", "默认"));
        assertEquals("默认", WebAppBridge.text(payload(), "empty", "默认"));
        assertEquals("默认", WebAppBridge.text(payload(), "missing", "默认"));
        // 空白串不算空：原样返回（调用方要自己 trim 才需要 trim）
        assertEquals("   ", WebAppBridge.text(payload(), "blank", "默认"));
    }

    /** 布尔值只认布尔和字符串 true。数字 1 不算真。 */
    @Test
    public void acceptsBooleanAndTrueString() {
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

    /** 数字接受小数和数字字符串，并截断成整数。 */
    @Test
    public void truncatesDecimalAndNumericText() {
        assertEquals(8, WebAppBridge.number(payload(), "count", 0));
        assertEquals(12, WebAppBridge.number(payload(), "numericText", 0));
        assertEquals(3, WebAppBridge.number(payload(), "missing", 3));
        // 取不到或不是数字时用默认值，不抛异常
        assertEquals(0, WebAppBridge.number(payload(), "media", 0));
        assertEquals(0, WebAppBridge.number(payload(), "title", 0));
    }

    /** 取值不是列表时给空表。 */
    @Test
    public void returnsEmptyListWhenValueIsNotAList() {
        assertEquals(2, WebAppBridge.list(payload(), "rows").size());
        assertTrue(WebAppBridge.list(payload(), "title").isEmpty());
        assertTrue(WebAppBridge.list(payload(), "missing").isEmpty());
    }

    /** 嵌套对象取不到时给空表。 */
    @Test
    public void returnsEmptyMapWhenNestedObjectIsMissing() {
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
    public void fallsBackToMessageWhenCodedFailureIsUnimplemented() {
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

    /**
     * 首帧外观 JSON 是页面与原生之间的契约：字段名与 mode 的归一化结果固定。
     * index.html 的内联脚本按 systemDark 决定 data-mode；字段名或类型一变，
     * 页面会退回 matchMedia——在 Android WebView 里等于「跟随系统失效」。
     */
    @Test
    public void serializesSystemAppearanceForFirstFrame() {
        assertEquals("{\"systemDark\":true,\"mode\":\"auto\"}", WebAppBridge.appearanceJson("auto", true));
        assertEquals("{\"systemDark\":false,\"mode\":\"light\"}", WebAppBridge.appearanceJson("light", false));
        assertEquals("{\"systemDark\":true,\"mode\":\"dark\"}", WebAppBridge.appearanceJson("dark", true));
        // 非法 / 缺失的 mode 一律归一化成 auto：JSON 里不能出现 null 或空串
        assertEquals("{\"systemDark\":false,\"mode\":\"auto\"}", WebAppBridge.appearanceJson("乱填", false));
        assertEquals("{\"systemDark\":false,\"mode\":\"auto\"}", WebAppBridge.appearanceJson(null, false));
    }


    /**
     * 写回页面的脚本必须对任意回调 id 都保持一个合法表达式。
     *
     * 换行 / U+2028 / U+2029 在 JavaScript 里是行终止符：只转义反斜杠和单引号的话，
     * 拼出来的脚本会变成语法错误，页面永远等不到回调（看起来就是「点了没反应」）。
     */
    @Test
    public void quotesCallbackIdAsJavaScriptStringLiteral() {
        assertEquals("'cb-7'", WebAppBridge.quote("cb-7"));
        assertEquals("''", WebAppBridge.quote(null));
        assertEquals("'a\\'b'", WebAppBridge.quote("a'b"));
        assertEquals("'a\\\\b'", WebAppBridge.quote("a\\b"));

        String[] tricky = { "a\nb", "a\rb", "a\u2028b", "a\u2029b", "a\u0001b" };
        for (String value : tricky) {
            String quoted = WebAppBridge.quote(value);
            for (int index = 0; index < quoted.length(); index++) {
                char current = quoted.charAt(index);
                assertTrue("引号结果不能含裸控制字符", current >= 0x20 && current != 0x2028 && current != 0x2029);
            }
        }
        assertTrue(WebAppBridge.quote("a\nb").contains("\\u000a"));
        assertTrue(WebAppBridge.quote("a\u2028b").contains("\\u2028"));
    }

    /** 脚本的参数顺序就是前端 onResult(callbackId, ok, result, error, code) 的契约。 */
    @Test
    public void assemblesResultScriptInProtocolOrder() {
        assertEquals(
                "window.CalMobileBridge&&window.CalMobileBridge.onResult('cb-7',true,{\"supported\":true},'',null);",
                WebAppBridge.resultScript("cb-7", true, "{\"supported\":true}", "''", "null"));
        assertEquals(
                "window.CalMobileBridge&&window.CalMobileBridge.onResult('cb-8',false,null,'已取消添加通行密钥','cancelled');",
                WebAppBridge.resultScript("cb-8", false, "null", "'已取消添加通行密钥'", "'cancelled'"));
        // 回调 id 里带单引号也不能提前闭合字符串字面量
        String injected = WebAppBridge.resultScript("cb-');alert(1);//", true, "null", "''", "null");
        assertTrue(injected.contains("onResult('cb-\\');alert(1);//'"));
    }

    /** 错误码是前后端约定的字面量，改名会让前端的取消静默 / 回退分支失效，因此钉住。 */
    @Test
    public void errorCodeLiteralsStayFixed() {
        assertEquals("cancelled", WebAppBridge.CODE_CANCELLED);
        assertEquals("timeout", WebAppBridge.CODE_TIMEOUT);
        // 旧壳没有某个动作时回这个码，页面据此退回浏览器实现（见 device-services 的 nativeOrBrowser）。
        assertEquals("unsupported", WebAppBridge.CODE_UNSUPPORTED);
    }
}
