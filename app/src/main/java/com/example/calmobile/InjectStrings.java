package com.example.calmobile;

import android.content.Context;
import android.content.res.Resources;

import com.google.gson.Gson;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把 res/values/strings_frontend.xml 里的前端文案注入 WebView。
 *
 * 文案本体维护在 Android 资源里（`scripts/extract-strings.js` 从 assets/web/js
 * 生成），页面加载完成后以 {@code window.CalMobileStrings = { key: 文案 }} 注入，
 * 前端 `js/core/strings.js` 的 t() 直接读它，因此文案只有一份来源。
 *
 * 资源名清单由脚本生成在 {@link FrontendStrings}（同包类），这里按名查值。
 * 用 getIdentifier 而不是 R.string 常量：文案随前端增删时不需要在构建期再挂代码生成，
 * 代价只是启动时一次查表。
 */
final class InjectStrings {

    private static final String TAG = "InjectStrings";
    private static final String TYPE = "string";

    private InjectStrings() {
    }

    /** 读取全部前端文案，返回 key → 文案。缺失的名字会被跳过（脚本会校验一致性）。 */
    static Map<String, String> load(Context context) {
        Map<String, String> strings = new LinkedHashMap<>();
        Resources resources = context.getResources();
        String packageName = context.getPackageName();
        int missing = 0;
        for (String name : FrontendStrings.NAMES) {
            int id = resources.getIdentifier(name, TYPE, packageName);
            if (id == 0) {
                missing += 1;
                continue;
            }
            strings.put(name, resources.getString(id));
        }
        if (missing > 0) {
            android.util.Log.w(TAG, "有 " + missing + " 条前端文案缺少资源，"
                    + "请重新运行 scripts/extract-strings.js");
        }
        return strings;
    }

    /** 生成注入脚本；文案已由 Gson 转义，可直接作为 JS 字面量。 */
    static String script(Map<String, String> strings) {
        return "window.CalMobileStrings=" + new Gson().toJson(strings) + ";";
    }

    /** 编排入口：读取全部前端文案并生成注入脚本。 */
    static String script(Context context) {
        return script(load(context));
    }
}
