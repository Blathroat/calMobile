package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 跨域共享的结构化输出与工具方法。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class ActionSupport {

    private ActionSupport() {
    }

    static String safe(String value) {
        return value == null ? "" : value;
    }

    static String registrationMode(String status) {
        if (ExhibitorExhibition.STATUS_DISPLAY_ONLY.equals(status)) {
            return "display";
        }
        if (ExhibitorExhibition.STATUS_CLOSED.equals(status)) {
            return "closed";
        }
        if (ExhibitorExhibition.STATUS_ENDED.equals(status)) {
            return "ended";
        }
        return "review";
    }

    static String modeLabel(String status) {
        switch (registrationMode(status)) {
            case "display":
                return "仅展示";
            case "closed":
                return "截止报名";
            case "ended":
                return "已结束";
            default:
                return ExhibitorExhibition.STATUS_REVIEW_OPTIONAL.equals(status)
                        ? "报名中 · 无需审核" : "报名中 · 需审核";
        }
    }

    static int yearOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(0, 4));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    static int monthOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(5, 7));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    static int dayOf(String date, int fallback) {
        try {
            return Integer.parseInt(date.substring(8, 10));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    static String summarize(String answers) {
        if (answers == null || answers.isEmpty()) {
            return "未收集额外信息";
        }
        String flat = answers.replace('\n', ' ').replace('\r', ' ').trim();
        return flat.length() > 46 ? flat.substring(0, 46) + "…" : flat;
    }}
