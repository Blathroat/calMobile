package com.example.calmobile;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * 这个 APK 能处理的原生动作名清单：{@code app.capabilities} 的回包，也是页面判断
 * 「新功能能不能走原生」的唯一依据。
 *
 * **为什么需要它**：页面可以随热更新先上线，APK 只能慢慢更新。新页面先问一次
 * {@code app.capabilities}，清单里没有的动作就退回浏览器实现（见
 * {@code web/src/services/device-services.ts} 的 {@code nativeOrBrowser}），
 * 不再把旧壳的「未实现的动作」当成页面故障；APK 因此变成可选增强。
 *
 * 清单按动作名字典序排列并去重，{@code app.capabilities} 自己也列在里面 ——
 * 问得到清单，就说明壳认识这个动作。**新增 / 删除动作时，这张清单和
 * {@link WebAppActions#handle} 的 switch 必须同时改**：页面只信这张清单，
 * 两边对不上会让页面以为能力存在（调用时才失败）或以为不存在（白走浏览器实现）。
 */
final class ShellCapabilities {

    /** 动作名全集：排序、去重后的不可变清单。 */
    private static final List<String> ACTIONS = Collections.unmodifiableList(
            new ArrayList<>(new TreeSet<>(Arrays.asList(
                    "app.capabilities",
                    "app.exit",
                    "calendar.status",
                    "calendar.toggle",
                    "camera.ensurePermission",
                    "export.csv",
                    "export.text",
                    "media.discard",
                    "media.import",
                    "media.importText",
                    "media.pickImage",
                    "media.saveImage",
                    "media.store",
                    "notify.requestPermission",
                    "passkey.available",
                    "passkey.create",
                    "passkey.get",
                    "session.clear",
                    "session.device",
                    "session.load",
                    "session.save",
                    "share.text",
                    "ui.sync"))));

    private ShellCapabilities() {
    }

    /**
     * {@code app.capabilities} 的回包：壳版本 + 支持的全部动作名。
     *
     * version 与 {@code WebShellActivity} 注入页面的 {@code __CALMOBILE_NATIVE_VERSION__}
     * 同源（都是 {@link BuildConfig#VERSION_NAME}），页面需要区分「页面构建号」与
     * 「外壳版本」时用得上。
     */
    static Map<String, Object> describe() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("version", BuildConfig.VERSION_NAME);
        data.put("actions", ACTIONS);
        return data;
    }

    /** 支持的动作名（排序、去重）。调用方只读，不要修改。 */
    static List<String> actions() {
        return ACTIONS;
    }
}
