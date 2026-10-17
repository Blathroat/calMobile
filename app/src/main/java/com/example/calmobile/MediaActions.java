package com.example.calmobile;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
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

    /** 复制到一半发现超过上限：已经删掉半成品，调用方按「超限」提示。 */
    static final long CANCELLED_OVERSIZE = Long.MIN_VALUE;

    /** 文本导入的默认上限：512 KB，够放一份语言包 JSON。 */
    static final int TEXT_IMPORT_MAX_BYTES = 512 * 1024;

    static void pickFile(WebAppBridge bridge, String mimeType, String chooserTitle,
            WebAppBridge.ResultCallback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        bridge.startForResult(Intent.createChooser(intent, chooserTitle), bridge.nextRequestCode(),
                new WebAppBridge.PendingResult("media.pick", callback));
    }

    /** 读取图片的 data URL：头像裁剪等场景由前端直接拿到可显示的内联图。 */
    private static String imageData(Context context, String uri) {
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

    /**
     * 从系统选择器读一个文本文件，正文由原生读出来回传。
     * <p>
     * 页面读不到设备文件：应用关着 setAllowFileAccess / setAllowContentAccess，
     * 渲染进程不保证能打开选择器返回的 content:// URI，语言包「从文件安装」因此走这里。
     */
    static void importText(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        applyMimeTypes(intent, WebAppBridge.text(payload, "mimeTypes", "application/json"));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        int maxBytes = WebAppBridge.number(payload, "maxBytes", TEXT_IMPORT_MAX_BYTES);
        if (maxBytes <= 0) {
            maxBytes = TEXT_IMPORT_MAX_BYTES;
        }
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("media.importText", callback);
        pending.context.put("maxBytes", Integer.valueOf(maxBytes));
        bridge.startForResult(Intent.createChooser(intent, "选择文本文件"),
                bridge.nextRequestCode(), pending);
    }

    /**
     * {@code mimeTypes} 是前端给的字符串（{@link WebAppBridge#text} 会把数组按逗号拼起来）：
     * 单个直接当 type，多个时用第一个当 type、其余放进 {@code EXTRA_MIME_TYPES}。
     * 一个都没有时退回 {@code application/json}。
     */
    private static void applyMimeTypes(Intent intent, String mimeTypes) {
        List<String> accepted = new ArrayList<>();
        if (mimeTypes != null) {
            for (String part : mimeTypes.split(",")) {
                String type = part.trim();
                if (!type.isEmpty()) {
                    accepted.add(type);
                }
            }
        }
        if (accepted.isEmpty()) {
            accepted.add("application/json");
        }
        intent.setType(accepted.get(0));
        if (accepted.size() > 1) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, accepted.toArray(new String[0]));
        }
    }

    /** {@code media.importText} 的选择结果：按 UTF-8 读正文回给页面。 */
    static void readImportedText(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure(WebAppBridge.CODE_CANCELLED, "已取消选择");
            return;
        }
        Uri uri = data.getData();
        int maxBytes = Number.class
                .cast(pending.context.getOrDefault("maxBytes", TEXT_IMPORT_MAX_BYTES)).intValue();
        byte[] raw;
        try {
            raw = readAtMostBytes(activity, uri, maxBytes);
        } catch (Exception error) {
            Log.w(TAG, "读取文本文件失败: " + uri, error);
            pending.callback.failure("读取文件失败：" + error.getMessage());
            return;
        }
        String tooLarge = textTooLargeReason(raw.length, declaredSize(activity, uri), maxBytes);
        if (tooLarge != null) {
            pending.callback.failure(tooLarge);
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("text", decodeText(raw));
        result.put("fileName", displayName(activity, uri));
        result.put("bytes", raw.length);
        pending.callback.success(result);
    }

    /**
     * 读内容 URI，最多读 {@code limit + 1} 字节。
     * <p>
     * 多读的那一字节专门用来判断「文件还没读完」：读到 {@code limit + 1} 就是超限，
     * 既不把超大文件整个读进内存，也能给出明确的上限提示。
     */
    static byte[] readAtMostBytes(Context context, Uri uri, int limit) throws Exception {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new java.io.IOException("无法打开文件");
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while (output.size() <= limit && (read = input.read(buffer)) > 0) {
                output.write(buffer, 0, Math.min(read, limit + 1 - output.size()));
            }
            return output.toByteArray();
        }
    }

    /** 选择器返回的文件展示名；读不到时给空串。 */
    static String displayName(Context context, Uri uri) {
        try (android.database.Cursor cursor = context.getContentResolver().query(uri,
                new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getString(0);
            }
        } catch (Exception error) {
            Log.w(TAG, "读取文件名失败: " + uri, error);
        }
        return "";
    }

    /**
     * 文本导入超限的说明；没超限返回 null。
     *
     * @param bytesRead     实际读到的字节数（读取时最多读 {@code maxBytes + 1} 个）
     * @param declaredBytes Provider 声明的大小，未知时给 -1
     * @param maxBytes      上限
     */
    static String textTooLargeReason(long bytesRead, long declaredBytes, int maxBytes) {
        if (bytesRead <= maxBytes) {
            return null;
        }
        if (declaredBytes > maxBytes) {
            return "文件 " + declaredBytes + " 字节，超过上限 " + maxBytes + " 字节（超出 "
                    + (declaredBytes - maxBytes) + " 字节）";
        }
        return "文件超过上限 " + maxBytes + " 字节（已读到 " + maxBytes + " 字节仍未结束）";
    }

    /** 按 UTF-8 解码，并剥掉 BOM。 */
    static String decodeText(byte[] bytes) {
        return stripBom(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
    }

    /** 去掉 UTF-8 BOM：语言包 JSON 常带 BOM，JSON.parse 遇到它直接报错。 */
    static String stripBom(String text) {
        return text != null && text.startsWith("\uFEFF") ? text.substring(1) : text;
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
        int limitMb = avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context);
        // 先按 base64 文本长度估算再解码：base64 是 4 字符 3 字节，超限的直接拒绝，
        // 免得先解出一个几十 MB 的数组（低内存设备上会 OOM，而 OOM 是 Error，catch 不住）。
        long limitBytes = limitMb * 1024L * 1024L;
        long estimatedBytes = (long) matcher.group(2).length() / 4 * 3;
        if (estimatedBytes > limitBytes) {
            result.put("ok", false);
            result.put("error", (avatar ? "头像" : "图片") + "超过 " + limitMb + " MB 限制");
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
        if (bytes.length > limitBytes) {
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
        int limitMb = video ? AppSettings.getMediaVideoSizeMb(context)
                : (avatar ? AppSettings.getMediaAvatarSizeMb(context)
                : AppSettings.getMediaImageSizeMb(context));
        try {
            if (video) {
                // 先按 ContentResolver 报的大小拦一道：视频是整份复制进应用目录的，
                // 选了个几 GB 的文件会直接把应用数据分区写满（而且读进内存时先 OOM）。
                long declaredBytes = declaredSize(context, uri);
                if (declaredBytes > limitMb * 1024L * 1024L) {
                    result.put("ok", false);
                    result.put("error", "视频超过 " + limitMb + " MB 限制");
                    return result;
                }
                String fileName = nextFileName(context, "video", extension);
                long bytes = copyToFile(context, uri, fileName, limitMb * 1024L * 1024L);
                if (bytes == CANCELLED_OVERSIZE) {
                    result.put("ok", false);
                    result.put("error", "视频超过 " + limitMb + " MB 限制");
                    return result;
                }
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

    /**
     * 删掉选择器刚写入的临时文件。
     *
     * 只接受媒体目录下的单层文件名，避免调用方用 {@code ..} 删到别的地方。
     */
    static Map<String, Object> discard(Context context, Map<String, Object> payload) {
        Map<String, Object> result = new LinkedHashMap<>();
        Object raw = payload == null ? null : payload.get("fileName");
        String fileName = raw == null ? "" : String.valueOf(raw);
        if (!fileName.matches("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")) {
            result.put("ok", false);
            return result;
        }
        try {
            java.io.File dir = WebShellActivity.mediaDir(context).getCanonicalFile();
            java.io.File target = new java.io.File(dir, fileName).getCanonicalFile();
            java.io.File parent = target.getParentFile();
            if (parent == null || !parent.getCanonicalPath().equals(dir.getCanonicalPath())) {
                result.put("ok", false);
                return result;
            }
            if (!target.isFile()) {
                result.put("ok", true);
                return result;
            }
            result.put("ok", target.delete());
        } catch (Exception error) {
            Log.w(TAG, "删除临时媒体失败", error);
            result.put("ok", false);
        }
        return result;
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

    /**
     * 流式复制到应用目录，超过 {@code limitBytes} 就停下并删掉半个文件。
     *
     * 只按 ContentResolver 声明的大小拦不够：有些 Provider 不报大小（返回 0/未知），
     * 所以复制过程里也要数着字节，别把一个几 GB 的文件真的写进数据分区。
     *
     * @return 实际字节数；失败返回负数；超限返回 {@link #CANCELLED_OVERSIZE}
     */
    static long copyToFile(Context context, Uri uri, String fileName, long limitBytes) throws Exception {
        java.io.File target = new java.io.File(WebShellActivity.mediaDir(context), fileName);
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             java.io.FileOutputStream output = new java.io.FileOutputStream(target)) {
            if (input == null) {
                return -1;
            }
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (limitBytes > 0 && total > limitBytes) {
                    output.close();
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                    return CANCELLED_OVERSIZE;
                }
                output.write(buffer, 0, read);
            }
            output.flush();
            return total;
        } catch (Exception error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw error;
        }
    }

    /** Provider 声明的大小；不报大小或读不到时返回 -1（不知情，交给复制过程数）。 */
    static long declaredSize(Context context, Uri uri) {
        android.database.Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(uri,
                    new String[] { android.provider.OpenableColumns.SIZE }, null, null, null);
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getLong(0);
            }
        } catch (Exception error) {
            Log.w(TAG, "读取文件大小失败", error);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1;
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

    /**
     * 系统分享面板。
     *
     * 弹的是系统界面，用户选完应用或取消我们都拿不到结果，所以**立刻回报成功**——
     * 之前不回调会让前端的 `await call('share.text')` 永远挂着（promise 与 pending 条目都泄漏）。
     */
    static void shareText(Activity activity, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        try {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_SUBJECT, WebAppBridge.text(payload, "title", ""));
            share.putExtra(Intent.EXTRA_TEXT, WebAppBridge.text(payload, "text", ""));
            activity.startActivity(Intent.createChooser(share, "分享展会"));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("shared", true);
            callback.success(result);
        } catch (Exception error) {
            // 设备上没有可接收分享的应用时 startActivity 会抛 ActivityNotFoundException。
            callback.failure("没有可以分享的应用");
        }
    }

    /**
     * 导出 CSV：数据行由前端传进来（它已经用后端的数据渲染过列表），
     * 原生只拼 CSV 并弹系统「另存为」面板。
     */
    static void exportCsv(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object raw : WebAppBridge.list(payload, "rows")) {
            if (raw instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> row = (Map<String, Object>) raw;
                rows.add(row);
            }
        }
        String csv = ExportManager.exhibitionsCsv(rows);
        if (csv == null) {
            callback.failure("没有可导出的数据");
            return;
        }
        String fileName = ExportManager.fileName("calmobile-exhibitions");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        int requestCode = bridge.nextRequestCode();
        WebAppBridge.PendingResult pending = new WebAppBridge.PendingResult("export.csv", callback);
        pending.context.put("csv", csv);
        pending.context.put("fileName", fileName);
        pending.context.put("rowCount", rows.size());
        bridge.startForResult(intent, requestCode, pending);
    }

    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        Activity activity = bridge.activity();
        if (pending.context.containsKey("csv")) {
            writeCsv(activity, pending, resultCode, data);
            return;
        }
        if (pending.context.containsKey("text")) {
            writeText(activity, pending, resultCode, data);
            return;
        }
        if (pending.context.containsKey("imageBytes")) {
            writeGalleryImage(activity, pending, resultCode, data);
            return;
        }
        if ("media.importText".equals(pending.action)) {
            readImportedText(activity, pending, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure(WebAppBridge.CODE_CANCELLED, "已取消选择");
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
            pending.callback.failure(WebAppBridge.CODE_CANCELLED, "已取消导出");
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
        // 行数用真实数据行数，而不是数 CSV 的换行：字段里的换行会被引号包起来，
        // 按 `split("\n")` 统计会把一行算成两行（页面会显示「已导出 N 行」）。
        result.put("rows", Number.class.cast(pending.context.getOrDefault("rowCount", 0)).intValue());
        pending.callback.success(result);
    }

    /**
     * 导出任意文本（语言包底稿）：正文由前端给，原生只弹系统「另存为」面板并写文件。
     * <p>
     * 与 CSV 不同，这里**不加** UTF-8 BOM：带 BOM 的 JSON 语言包会让部分解析器直接报错。
     */
    static void exportText(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String content = WebAppBridge.text(payload, "content", "");
        String mimeType = WebAppBridge.text(payload, "mimeType", "application/json");
        String fileName = WebAppBridge.text(payload, "fileName", "");
        if (fileName.isEmpty()) {
            fileName = ExportManager.fileName("calmobile-text", ExportManager.textExtension(mimeType));
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        WebAppBridge.PendingResult pending = new WebAppBridge.PendingResult("export.text", callback);
        pending.context.put("text", content);
        pending.context.put("fileName", fileName);
        bridge.startForResult(intent, bridge.nextRequestCode(), pending);
    }

    /** 「另存为」返回后按 UTF-8 写文本；用户取消走 cancelled，不是故障。 */
    static void writeText(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure(WebAppBridge.CODE_CANCELLED, "已取消保存");
            return;
        }
        String text = String.valueOf(pending.context.get("text"));
        try (java.io.OutputStream output =
                     activity.getContentResolver().openOutputStream(data.getData())) {
            if (output == null) {
                pending.callback.failure("无法写入所选文件");
                return;
            }
            output.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            output.flush();
        } catch (Exception error) {
            pending.callback.failure("保存失败：" + error.getMessage());
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exported", true);
        result.put("fileName", String.valueOf(pending.context.get("fileName")));
        pending.callback.success(result);
    }

    /**
     * 保存图片到系统相册（报名二维码长按保存）。
     * <p>
     * API 29 起写 MediaStore，不需要任何存储权限；minSdk 24 的老系统没有分区存储，
     * 为一次保存去申请 WRITE_EXTERNAL_STORAGE 不值当，改走系统「另存为」面板让用户自己选位置。
     */
    static void saveImage(WebAppBridge bridge, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        String[] parts = imageDataUrlParts(WebAppBridge.text(payload, "dataUrl", ""));
        if (parts == null) {
            callback.failure("无法识别的图片数据");
            return;
        }
        String mime = parts[0];
        if (!isGalleryImageMime(mime)) {
            callback.failure("只支持 PNG / JPEG 图片，当前是 " + mime);
            return;
        }
        if ("image/jpg".equals(mime)) {
            mime = "image/jpeg";
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(parts[1], Base64.DEFAULT);
        } catch (Exception error) {
            callback.failure("图片数据解析失败");
            return;
        }
        if (bytes.length == 0) {
            callback.failure("图片数据为空");
            return;
        }
        Activity activity = bridge.activity();
        String fileName = galleryFileName(mime, WebAppBridge.text(payload, "fileName", ""));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Uri uri = insertIntoGallery(activity, fileName, mime, bytes);
            if (uri == null) {
                callback.failure("保存到相册失败");
                return;
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("saved", true);
            result.put("uri", uri.toString());
            callback.success(result);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        WebAppBridge.PendingResult pending =
                new WebAppBridge.PendingResult("media.saveImage", callback);
        pending.context.put("imageBytes", bytes);
        pending.context.put("fileName", fileName);
        bridge.startForResult(intent, bridge.nextRequestCode(), pending);
    }

    /** 写进系统相册。失败时删掉刚插入的空行，不留一张打不开的图。 */
    private static Uri insertIntoGallery(Context context, String fileName, String mime, byte[] bytes) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        // 归到自己的目录，用户在相册里能按 Pictures/calMobile 找到导出的二维码。
        values.put(MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/calMobile");
        Uri target = context.getContentResolver()
                .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (target == null) {
            return null;
        }
        try (java.io.OutputStream output = context.getContentResolver().openOutputStream(target)) {
            if (output == null) {
                throw new java.io.IOException("无法打开相册写入流");
            }
            output.write(bytes);
            output.flush();
        } catch (Exception error) {
            Log.w(TAG, "写入相册失败: " + fileName, error);
            //noinspection ResultOfMethodCallIgnored
            context.getContentResolver().delete(target, null, null);
            return null;
        }
        return target;
    }

    /** 老系统的「另存为」返回后，把暂存的字节写进用户选的文件。 */
    static void writeGalleryImage(Activity activity, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            pending.callback.failure(WebAppBridge.CODE_CANCELLED, "已取消保存");
            return;
        }
        byte[] bytes = (byte[]) pending.context.get("imageBytes");
        try (java.io.OutputStream output =
                     activity.getContentResolver().openOutputStream(data.getData())) {
            if (output == null) {
                pending.callback.failure("无法写入所选文件");
                return;
            }
            output.write(bytes);
            output.flush();
        } catch (Exception error) {
            pending.callback.failure("保存失败：" + error.getMessage());
            return;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("saved", true);
        result.put("fileName", String.valueOf(pending.context.get("fileName")));
        pending.callback.success(result);
    }

    /**
     * 解析图片 data URL，返回 {@code {mime, base64}}；认不出时返回 null。
     * <p>
     * 与 {@link #storeDataUrl} 共用同一张 {@link #DATA_URL} 正则，避免两处解析规则漂移。
     */
    static String[] imageDataUrlParts(String dataUrl) {
        if (dataUrl == null || dataUrl.isEmpty()) {
            return null;
        }
        java.util.regex.Matcher matcher = DATA_URL.matcher(dataUrl);
        if (!matcher.matches()) {
            return null;
        }
        return new String[] { matcher.group(1).toLowerCase(java.util.Locale.US), matcher.group(2) };
    }

    /** 相册只收 PNG 与 JPEG：webp / gif 在部分相册应用里会显示成空白。 */
    static boolean isGalleryImageMime(String mime) {
        return "image/png".equals(mime) || "image/jpeg".equals(mime) || "image/jpg".equals(mime);
    }

    /** 相册里的展示名：调用方没给就用 calmobile-qr-时间戳.后缀。 */
    static String galleryFileName(String mime, String provided) {
        if (provided != null && !provided.trim().isEmpty()) {
            return provided.trim();
        }
        String extension = "image/png".equals(mime) ? "png" : "jpg";
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.getDefault())
                .format(new java.util.Date());
        return "calmobile-qr-" + stamp + "." + extension;
    }

    /** 选择图片：把结果交回前端做裁剪等后续处理。 */
    static void pickImage(WebAppBridge bridge, WebAppBridge.ResultCallback callback) {
        pickFile(bridge, "image/*", "选择图片", callback);
    }
}
