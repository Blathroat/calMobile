package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 会话存储的纯逻辑部分。
 *
 * `SessionStore.save` / `clear` 在真机上就两件事：归一化输入、决定写哪几个键。
 * 第二步在单测里没有 `SharedPreferences`（也不引入 Robolectric），于是它被抽成
 * {@link SessionStore.State} 这个不可变状态机，真机代码与单测断言同一条规则——
 * 与 `AppSettingsTest` 只测不依赖 Android 运行时的部分是一个做法。
 *
 * 这里不覆盖「真的写进文件再读出来」：那需要设备或 Robolectric，
 * 由 `gradlew.bat :app:assembleDebug` 与实际运行保证。
 */
public class SessionStoreTest {

    /** 冷启动要先判断「有没有会话」：空串必须与「没存过」等价，否则会跳过登录页去换令牌。 */
    @Test
    public void 空令牌不算有会话() {
        assertFalse(SessionStore.isPresent(null));
        assertFalse(SessionStore.isPresent(""));
        assertFalse(SessionStore.isPresent("   "));
        assertTrue(SessionStore.isPresent("rt-1"));
    }

    @Test
    public void 归一化会去首尾空白并把空值收敛成空串() {
        assertEquals("rt-1", SessionStore.normalize("  rt-1\n"));
        assertEquals("张三", SessionStore.normalize("\t张三 "));
        assertEquals("", SessionStore.normalize(null));
        assertEquals("", SessionStore.normalize("   "));
    }

    /** 写入后能读回，且首尾空白已经在落盘前去掉（令牌原样拼进请求头会非法）。 */
    @Test
    public void 写入会话后能读回并已去空白() {
        SessionStore.State saved = SessionStore.State.empty().apply("  rt-1 \n", " 张三 ");
        assertTrue(saved.present());
        assertEquals("rt-1", saved.refreshToken);
        assertEquals("张三", saved.username);

        // 从盘上读回（load）：已归一化的值再读一次不变，说明读回的就是同一份状态
        SessionStore.State loaded = new SessionStore.State(saved.refreshToken, saved.username);
        assertEquals("rt-1", loaded.refreshToken);
        assertEquals("张三", loaded.username);
        assertTrue(loaded.present());
    }

    /** 空令牌等价于清除：连用户名一起清，不留「上次登录 xxx」的回填痕迹。 */
    @Test
    public void 空令牌等价于清除且不留下用户名() {
        SessionStore.State saved = SessionStore.State.empty().apply("rt-1", "张三");
        assertTrue(saved.present());

        for (String blank : new String[] { null, "", "   ", "\n" }) {
            SessionStore.State cleared = saved.apply(blank, "张三");
            assertFalse("空令牌应为无会话：" + blank, cleared.present());
            assertEquals("", cleared.refreshToken);
            assertEquals("", cleared.username);
        }
    }

    /** 覆盖写入：第二次保存要整体替换，不能把上一次的用户名留下。 */
    @Test
    public void 再次保存会整体替换上一次的会话() {
        SessionStore.State first = SessionStore.State.empty().apply("rt-1", "张三");
        SessionStore.State second = first.apply("rt-2", "");
        assertEquals("rt-2", second.refreshToken);
        assertEquals("", second.username);
        assertTrue(second.present());
    }

    /** 初始状态与清除后的状态一致：都是空会话。 */
    @Test
    public void 清除后回到空会话() {
        SessionStore.State empty = SessionStore.State.empty();
        assertFalse(empty.present());
        assertEquals("", empty.refreshToken);
        assertEquals("", empty.username);
        assertEquals("", empty.apply("", "").refreshToken);
        assertEquals(empty.username, empty.apply("", "").username);
    }
}
