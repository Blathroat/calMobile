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
 * 媒体落盘、分享、导出，以及系统界面与权限回调。
 * <p>
 * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。
 */
final class MediaActions {

    private static final String TAG = "WebAppActions";

    private MediaActions() {
    }

    private static final java.util.regex.Pattern DATA_URL = java.util.regex.Pattern.compile(
            "^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\\s]+)$",
            java.util.regex.Pattern.DOTALL);

    private static final java.util.regex.Pattern INLINE_IMAGE = java.util.regex.Pattern.compile(
            "data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+");

    private static final java.util.concurrent.atomic.AtomicInteger FILE_SEQUENCE =
            new java.util.concurrent.atomic.AtomicInteger(1);

    static void pickFile(WebAppBridge bridge, String mimeType, String chooserTitle,
            WebAppBridge.ResultCallback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        bridge.startForResult(Intent.createChooser(intent, chooserTitle), bridge.nextRequestCode(),
                new WebAppBridge.PendingResult("media.pick", callback));
    }

    static String imageData(Context context, String uri) {
        if (uri == null || uri.isEmpty() || context == null) {
            return "";
        }
        try (InputStream input = context.getContentResolver().openInputStream(Uri.parse(uri))) {
            if (input == null) {
                return "";
            }
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            if (bitmap == null) {
                return "";
            }
            int max = 1080;
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            if (width > max || height > max) {
                float ratio = Math.min(max / (float) width, max / (float) height);
                bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(width * ratio),
                        Math.round(height * ratio), true);
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output);
            return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } catch (Exception error) {
            Log.w(TAG, "图片读取失败: " + uri, error);
            return "";
        }
    }

    static void importMedia(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String kind = WebAppBridge.text(payload, "kind", "image");
        boolean video = "video".equals(kind);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(video ? "video/*" : "image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("media.import", callback);
        pending.context.put("kind", kind);
        pending.context.put("avatar", Boolean.valueOf("avatar".equals(kind)));
        bridge.startForResult(Intent.createChooser(intent, video ? "选择视频" : "选择图片"),
                bridge.nextRequestCode(), pending);
    }

    static Map<String, Object> storeDataUrl(Context context, Map<String, Object> payload) {
        String dataUrl = WebAppBridge.text(payload, "dataUrl", "");
        String kind = WebAppBridge.text(payload, "kind", "image");
        Map<String, Object> result = new LinkedHashMap<>();
        java.util.regex.Matcher matcher = DATA_URL.matcher(dataUrl);
        if (!matcher.matches()) {
            result.put("ok", false);
            result.put("error", "无法识别的图片数据");
            return result;
        }
        String mime = matcher.group(1).toLowerCase(java.util.Locale.US);
        String extension = mime.contains("png") ? "png" : "jpg";
        boolean avatar = "avatar".equals(kind);
        List<String> formats = imageFormatsFor(context, kind);
        boolean allowedFormat = formats.contains(extension)
                || ("jpg".equals(extension) && formats.contains("jpeg"));
        if (!allowedFormat) {
            result.put("ok", false);
            result.put("error", "服务器设置不允许上传 ." + extension + " 格式，允许："
                    + String.join("、", formats));
            return result;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(matcher.group(2), Base64.DEFAULT);
        } catch (Exception error) {
            result.put("ok", false);
            result.put("error", "图片数据解析失败");
            return result;
        }
        int limitMb = avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context);
        if (bytes.length > limitMb * 1024L * 1024L) {
            result.put("ok", false);
            result.put("error", (avatar ? "头像" : "图片") + "超过 " + limitMb + " MB 限制");
            return result;
        }
        String fileName = nextFileName(context, avatar ? "avatar" : "image", extension);
        if (!writeFile(context, fileName, bytes)) {
            result.put("ok", false);
            result.put("error", "文件写入失败");
            return result;
        }
        result.put("ok", true);
        result.put("error", "");
        result.put("url", WebShellActivity.MEDIA_URL + fileName);
        result.put("bytes", bytes.length);
        result.put("fileName", fileName);
        return result;
    }

    static List<String> imageFormatsFor(Context context, String kind) {
        return AppSettings.getImageFormats(context);
    }

    static Map<String, Object> storeUri(Context context, Uri uri, boolean avatar) {
        Map<String, Object> result = new LinkedHashMap<>();
        String mime = context.getContentResolver().getType(uri);
        boolean video = mime != null && mime.startsWith("video/");
        List<String> formats = video ? AppSettings.getVideoFormats(context)
                : AppSettings.getImageFormats(context);
        String extension = extensionOf(context, uri, mime);
        if (extension.isEmpty() || !formats.contains(extension)) {
            result.put("ok", false);
            result.put("error", "服务器设置不允许上传 ." + (extension.isEmpty() ? "未知" : extension)
                    + " 格式，允许：" + String.join("、", formats));
            return result;
        }
        int limitMb = video ? 0 : (avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context));
        try {
            if (video) {
                String fileName = nextFileName(context, "video", extension);
                long bytes = copyToFile(context, uri, fileName);
                if (bytes <= 0) {
                    result.put("ok", false);
                    result.put("error", "视频读取失败");
                    return result;
                }
                result.put("ok", true);
                result.put("error", "");
                result.put("url", WebShellActivity.MEDIA_URL + fileName);
                result.put("mimeType", mime == null ? "" : mime);
                result.put("bytes", bytes);
                result.put("fileName", fileName);
                return result;
            }
            byte[] raw = readBytes(context, uri);
            if (raw == null || raw.length == 0) {
                result.put("ok", false);
                result.put("error", "图片读取失败");
                return result;
            }
            boolean small = raw.length <= limitMb * 1024L * 1024L;
            Bitmap bitmap = small ? null : decodeScaled(raw, avatar ? 640 : 1920);
            if (bitmap == null) {
                // 未超限或无法解码时保持原文件，保留 GIF/PNG 等格式的原始数据。
                String fileName = nextFileName(context, avatar ? "avatar" : "image", extension);
                if (!writeFile(context, fileName, raw)) {
                    result.put("ok", false);
                    result.put("error", "文件写入失败");
                    return result;
                }
                result.put("ok", true);
                result.put("error", "");
                result.put("url", WebShellActivity.MEDIA_URL + fileName);
                result.put("mimeType", mime == null ? "" : mime);
                result.put("bytes", raw.length);
                result.put("fileName", fileName);
                return result;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 86, output);
            byte[] compressed = output.toByteArray();
            String fileName = nextFileName(context, avatar ? "avatar" : "image", "jpg");
            if (!writeFile(context, fileName, compressed)) {
                result.put("ok", false);
                result.put("error", "文件写入失败");
                return result;
            }
            result.put("ok", true);
            result.put("error", "");
            result.put("url", WebShellActivity.MEDIA_URL + fileName);
            result.put("mimeType", "image/jpeg");
            result.put("bytes", compressed.length);
            result.put("fileName", fileName);
            result.put("compressed", true);
            return result;
        } catch (Exception error) {
            Log.w(TAG, "上传文件处理失败: " + uri, error);
            result.put("ok", false);
            result.put("error", "上传失败：" + error.getMessage());
            return result;
        }
    }

    static String inlineDataUrlsToFiles(Context context, String description) {
        if (description == null || !description.contains("data:image/")) {
            return description;
        }
        java.util.regex.Matcher matcher = INLINE_IMAGE.matcher(description);
        StringBuilder builder = new StringBuilder();
        int count = 0;
        while (matcher.find()) {
            String dataUrl = matcher.group();
            java.util.regex.Matcher parts = DATA_URL.matcher(dataUrl);
            if (!parts.matches()) {
                continue;
            }
            byte[] bytes;
            try {
                bytes = Base64.decode(parts.group(2), Base64.DEFAULT);
            } catch (Exception error) {
                continue;
            }
            int maxBytes = AppSettings.getMediaImageSizeMb(context) * 1024 * 1024;
            String extension = parts.group(1).contains("png") ? "png" : "jpg";
            byte[] payload = bytes;
            String usedExtension = extension;
            if (bytes.length > maxBytes) {
                Bitmap bitmap = decodeScaled(bytes, 1920);
                if (bitmap != null) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 86, output);
                    payload = output.toByteArray();
                    usedExtension = "jpg";
                }
            }
            String fileName = nextFileName(context, "desc", usedExtension);
            if (!writeFile(context, fileName, payload)) {
                continue;
            }
            matcher.appendReplacement(builder,
                    java.util.regex.Matcher.quoteReplacement(WebShellActivity.MEDIA_URL + fileName));
            count += 1;
        }
        matcher.appendTail(builder);
        if (count > 0) {
            Log.d(TAG, "简介内联图片已改写为本地 URL，共 " + count + " 张");
        }
        return builder.toString();
    }

    static String nextFileName(Context context, String prefix, String extension) {
        String safePrefix = prefix == null || prefix.isEmpty() ? "file" : prefix;
        return safePrefix + "-" + System.currentTimeMillis() + "-" + FILE_SEQUENCE.getAndIncrement()
                + "." + extension;
    }

    static boolean writeFile(Context context, String fileName, byte[] bytes) {
        try (java.io.FileOutputStream output =
                     new java.io.FileOutputStream(new java.io.File(WebShellActivity.mediaDir(context), fileName))) {
            output.write(bytes);
            output.flush();
            return true;
        } catch (Exception error) {
            Log.w(TAG, "文件写入失败: " + fileName, error);
            return false;
        }
    }

    static long copyToFile(Context context, Uri uri, String fileName) throws Exception {
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             java.io.FileOutputStream output =
                     new java.io.FileOutputStream(new java.io.File(WebShellActivity.mediaDir(context), fileName))) {
            if (input == null) {
                return -1;
            }
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
                total += read;
            }
            output.flush();
            return total;
        }
    }

    static byte[] readBytes(Context context, Uri uri) {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) {
                return null;
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } catch (Exception error) {
            Log.w(TAG, "文件读取失败: " + uri, error);
            return null;
        }
    }

    static Bitmap decodeScaled(byte[] bytes, int maxSide) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            return null;
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) {
            return null;
        }
        int longSide = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (longSide <= maxSide) {
            return bitmap;
        }
        float ratio = maxSide / (float) longSide;
        return Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)),
                Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
    }

    static String extensionOf(Context context, Uri uri, String mime) {
        String name = null;
        try (android.database.Cursor cursor = context.getContentResolver()
                .query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    name = cursor.getString(index);
                }
            }
        } catch (Exception ignored) {
            // 查询失败时退回 MIME 推断
        }
        if (name != null && name.contains(".")) {
            return name.substring(name.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.US);
        }
        if (mime == null) {
            return "";
        }
        String lower = mime.toLowerCase(java.util.Locale.US);
        if (lower.startsWith("image/")) {
            String subtype = lower.substring("image/".length());
            return "jpeg".equals(subtype) ? "jpg" : subtype;
        }
        if (lower.startsWith("video/")) {
            String subtype = lower.substring("video/".length());
            if ("quicktime".equals(subtype)) {
                return "mov";
            }
            return subtype;
        }
        return "";
    }

    static void shareText(Activity activity, Map<String, Object> payload) {        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_SUBJECT, WebAppBridge.text(payload, "title", ""));
        share.putExtra(Intent.EXTRA_TEXT, WebAppBridge.text(payload, "text", ""));
        activity.startActivity(Intent.createChooser(share, "分享展会"));
    }

    static void exportCsv(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String type = WebAppBridge.text(payload, "type", "exhibitions");
        String csv;
        String fileName;
        if ("registrations".equals(type)) {
            csv = ExportManager.exportRegistrations(bridge.activity());
            fileName = "calmobile-registrations.csv";
        } else if ("users".equals(type)) {
            csv = ExportManager.exportUsers(bridge.activity());
            fileName = "calmobile-users.csv";
        } else {
            csv = ExportManager.exportExhibitions(bridge.activity());
            fileName = "calmobile-exhibitions.csv";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending = new WebAppBridge.PendingResult("export.csv", callback);
        pending.context.put("csv", csv);
        pending.context.put("fileName", fileName);
        bridge.startForResult(intent, requestCode, pending);
    }

    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        Activity activity = bridge.activity();
        if (pending.context.containsKey("csv")) {
            writeCsv(activity, pending, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消选择");
            return;
        }
        Uri uri = data.getData();
        if ("media.import".equals(pending.action)) {
            Map<String, Object> stored = storeUri(activity, uri, Boolean.TRUE.equals(pending.context.get("avatar")));
            if (Boolean.TRUE.equals(stored.get("ok"))) {
                pending.callback.success(stored);
            } else {
                pending.callback.failure(String.valueOf(stored.get("error")));
            }
            return;
        }
        String mime = activity.getContentResolver().getType(uri);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("uri", uri.toString());
        result.put("mimeType", mime == null ? "" : mime);
        result.put("dataUrl", mime != null && mime.startsWith("image/")
                ? imageData(activity, uri.toString()) : "");
        pending.callback.success(result);
    }

    static void writeCsv(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure("已取消导出");
            return;
        }
        String csv = String.valueOf(pending.context.get("csv"));
        try (java.io.OutputStream output =
                     activity.getContentResolver().openOutputStream(data.getData())) {
            if (output == null) {
                pending.callback.failure("无法写入所选文件");
                return;
            }
            output.write(csv.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception error) {
            pending.callback.failure("导出失败：" + error.getMessage());
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        result.put("fileName", String.valueOf(pending.context.get("fileName")));
        result.put("rows", Math.max(0, csv.split("\n").length - 1));
        pending.callback.success(result);
    }
    /** 选择图片：把结果交回前端做裁剪等后续处理。 */
    static void pickImage(WebAppBridge bridge, WebAppBridge.ResultCallback callback) {
        pickFile(bridge, "image/*", "选择图片", callback);
    }

    /** 选择视频：当前只做选择器占位，不做上传与转码。 */
    static void pickVideo(WebAppBridge bridge, WebAppBridge.ResultCallback callback) {
        pickFile(bridge, "video/*", "选择视频", callback);
    }

    /** 原生 Toast：少数不便于走 Web 提示的场景使用。 */
    static boolean toast(Activity activity, Map<String, Object> payload) {
        String message = WebAppBridge.text(payload, "message", "");
        if (message != null && !message.isEmpty()) {
            android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_SHORT).show();
        }
        return true;
    }
}
