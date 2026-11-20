package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Assume;
import org.junit.Test;

/**
 * {@code app.capabilities} 的清单与回包形状。
 *
 * 页面靠这份清单决定新功能走原生还是浏览器：清单漏一个动作，页面会默默退回浏览器实现；
 * 多了清单里没有的动作，页面会在调用时收到 unsupported。这里钉住三件事 ——
 * 清单非空且不含重复、顺序稳定（字典序）、回包就是 version + actions 两个字段。
 *
 * 第 4 条断言（代表性动作必须在清单里）不是重复清单本身：它防的是「改 switch 时顺手
 * 从清单里删掉某个已有动作」这类事故，因为页面已经按这些名字调用原生。
 */
public class ShellCapabilitiesTest {

    /** 清单不能为空，也不能有重复或空串。 */
    @Test
    public void actionsAreNotEmptyAndUnique() {
        List<String> actions = ShellCapabilities.actions();
        assertFalse("能力清单不能为空", actions.isEmpty());
        assertEquals("动作名不能重复", new HashSet<>(actions).size(), actions.size());
        assertFalse("动作名不能是空串", actions.contains(""));
        assertFalse("动作名不能是 null", actions.contains(null));
    }

    /** 顺序必须稳定：清单按字典序排列，页面缓存与对比都依赖它。 */
    @Test
    public void actionsAreSorted() {
        List<String> sorted = new ArrayList<>(ShellCapabilities.actions());
        Collections.sort(sorted);
        assertEquals(sorted, ShellCapabilities.actions());
    }

    /** 页面已经在按这些动作名调用原生，清单不能漏。 */
    @Test
    public void actionsContainContractNames() {
        List<String> actions = ShellCapabilities.actions();
        for (String action : new String[] {
                "app.capabilities",
                "app.exit",
                "ui.sync",
                "camera.ensurePermission",
                "calendar.status",
                "calendar.toggle",
                "notify.requestPermission",
                "media.pickImage",
                "media.import",
                "media.importText",
                "media.store",
                "media.discard",
                "media.saveImage",
                "share.text",
                "export.csv",
                "export.text",
                "session.save",
                "session.load",
                "session.clear",
                "session.device",
                "passkey.available",
                "passkey.create",
                "passkey.get" }) {
            assertTrue("能力清单缺少动作：" + action, actions.contains(action));
        }
    }

    /** 回包形状：正好 version + actions 两个字段，actions 就是同一份只读清单。 */
    @Test
    public void payloadCarriesVersionAndActions() {
        Map<String, Object> data = ShellCapabilities.describe();
        assertEquals(2, data.size());
        assertEquals("version", data.keySet().iterator().next());
        assertEquals(BuildConfig.VERSION_NAME, data.get("version"));
        assertSame(ShellCapabilities.actions(), data.get("actions"));
    }

    /** 清单是共享的只读单例：调用方就地修改会让所有页面看到的能力一起变。 */
    @Test
    public void actionsListIsReadOnly() {
        assertThrows(UnsupportedOperationException.class, () -> ShellCapabilities.actions().add("app.fake"));
    }

    /**
     * 能力清单与 {@code WebAppActions.handle} 的 switch 是同一份契约的两半，必须一一对应：
     * 清单多了，页面会以为能动用原生、调用时才发现动作不存在；清单少了，页面会白走浏览器实现。
     *
     * 这里直接读源码里的 {@code case "..."} 标签做双向核对（纯 JVM，不启动 Android）。
     * 在常规单元测试工作目录（app/）下能读到；读不到时跳过，不让环境差异变成红灯。
     */
    @Test
    public void capabilityListMatchesActionSwitch() throws Exception {
        File source = findSource("src/main/java/com/example/calmobile/WebAppActions.java");
        Assume.assumeTrue("找不到 WebAppActions.java 源码，跳过 switch 核对", source != null);
        String text = new String(Files.readAllBytes(source.toPath()), StandardCharsets.UTF_8);
        List<String> declared = new ArrayList<>();
        Matcher matcher = Pattern.compile("case \"([a-zA-Z.]+)\":").matcher(text);
        while (matcher.find()) {
            declared.add(matcher.group(1));
        }
        assertFalse("switch 里一个动作都没读到，源码格式可能变了", declared.isEmpty());
        assertEquals("能力清单必须与 WebAppActions.handle 的 switch 一一对应",
                new TreeSet<>(ShellCapabilities.actions()), new TreeSet<>(declared));
    }

    /** 在几个可能的工作目录下找源码：Gradle 单测默认在模块目录（app/），也兼容从仓库根跑。 */
    private static File findSource(String relative) {
        for (String root : new String[] { ".", "..", "../app" }) {
            File file = new File(root, relative);
            if (file.isFile()) {
                return file;
            }
        }
        return null;
    }
}
