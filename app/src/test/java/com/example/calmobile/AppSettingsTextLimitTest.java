package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

/**
 * 字符数上限表的自洽性。
 *
 * 上限原来是四组按下标对齐的数组，默认值越界（例如默认 200 却把上限定成 120）
 * 既不会编译报错、也不会立刻显形。这里把「这张表本身必须成立」的约束固定下来，
 * 新增一项上限时这些断言会自动覆盖到它。
 */
public class AppSettingsTextLimitTest {

    /** 与前端 state.limits 的键名一致，改名要两边一起改。 */
    private static final Set<String> EXPECTED = new HashSet<>(Arrays.asList(
            "exhibitionTitle", "exhibitionVenue", "category", "fieldTitle",
            "usernameMin", "usernameMax", "passwordMin", "passwordMax",
            "nickname", "bio", "region", "answer"));

    @Test
    public void 每一项的默认值都落在自己的范围内() {
        for (AppSettings.TextLimit limit : AppSettings.TextLimit.values()) {
            assertTrue(limit.name() + " 默认值 " + limit.fallback + " 小于下限 " + limit.min,
                    limit.fallback >= limit.min);
            assertTrue(limit.name() + " 默认值 " + limit.fallback + " 大于上限 " + limit.max,
                    limit.fallback <= limit.max);
            assertTrue(limit.name() + " 的下限大于上限", limit.min <= limit.max);
        }
    }

    @Test
    public void 前端键名不多不少且不重复() {
        Set<String> actual = new HashSet<>();
        for (AppSettings.TextLimit limit : AppSettings.TextLimit.values()) {
            assertNotNull(limit.wireName);
            assertTrue("键名重复：" + limit.wireName, actual.add(limit.wireName));
        }
        assertEquals(EXPECTED, actual);
    }

    @Test
    public void 成对的上下限默认值互不矛盾() {
        assertTrue(AppSettings.TextLimit.USERNAME_MIN.fallback <= AppSettings.TextLimit.USERNAME_MAX.fallback);
        assertTrue(AppSettings.TextLimit.PASSWORD_MIN.fallback <= AppSettings.TextLimit.PASSWORD_MAX.fallback);
    }
}
