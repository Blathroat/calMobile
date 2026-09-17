/**
 * 按动作域拆分 WebAppActions.java。
 *
 * 三步串成一个脚本，避免互相踩输入（前几次失败正是因为「重写 WebAppActions」
 * 覆盖了「拆分」要读的源码）：
 *
 *   1. 从 git HEAD 读原始 WebAppActions.java —— 与工作区状态无关，可反复执行；
 *   2. 按**方法边界**切分到各动作类（不按行号：行号边界漂一行就会把方法切成两半）；
 *   3. 重写 WebAppActions.java 为纯分发入口，并补上原来写在 switch 里的薄方法。
 *
 * 用法：node scripts/split-webapp-actions.js [--write]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const javaDir = path.join(root, 'app', 'src', 'main', 'java', 'com', 'example', 'calmobile');
const origin = 'app/src/main/java/com/example/calmobile/WebAppActions.java';
const write = process.argv.includes('--write');

// ── 1. 原始源码 ──────────────────────────────────────────────────

function pristineSource() {
    const text = execFileSync('git', ['show', `HEAD:${origin}`], { cwd: root, encoding: 'utf8' });
    return text.split(/\r?\n/);
}

const source = pristineSource();
console.log(`原始 WebAppActions.java: ${source.length} 行`);

// ── 2. 方法扫描 ──────────────────────────────────────────────────

/**
 * 扫描静态方法的完整区间。
 * 方法体整段搬运（保持 4 空格缩进），结束位置用花括号计数确定。
 */
function scanMethods(lines) {
    const methods = [];
    const ONE_LINE = /^\s*(?:private |public |protected )?static\b[^(]*?\b(\w+)\(/;
    const RETURN_ONLY = /^\s*(?:private |public |protected )?static\b[^(]*$/;
    const NAME_LINE = /^\s*(\w+)\(/;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/^\s*(?:private |public |protected )?static\b/.test(line)) {
            continue;
        }
        // static final 字段（例如 Pattern.compile(...)）不是方法
        if (/^\s*(?:private |public |protected )?static\s+final\b/.test(line)) {
            continue;
        }
        let name = null;
        let bodyStart = index;
        if (RETURN_ONLY.test(line) && lines[index + 1] && NAME_LINE.test(lines[index + 1])) {
            name = NAME_LINE.exec(lines[index + 1])[1];
            bodyStart = index + 1;
        } else {
            const match = ONE_LINE.exec(line);
            if (match) {
                name = match[1];
            } else if (lines[index + 1] && NAME_LINE.test(lines[index + 1])) {
                name = NAME_LINE.exec(lines[index + 1])[1];
                bodyStart = index + 1;
            }
        }
        if (!name) {
            continue;
        }

        let depth = 0;
        let started = false;
        let end = bodyStart;
        for (let cursor = bodyStart; cursor < lines.length; cursor += 1) {
            for (const char of lines[cursor]) {
                if (char === '{') {
                    depth += 1;
                    started = true;
                } else if (char === '}') {
                    depth -= 1;
                }
            }
            if (started && depth === 0) {
                end = cursor;
                break;
            }
        }

        methods.push({ name, start: index, end });
        index = end;
    }
    return methods;
}

// handle() 是分发入口本身；toast() 是原文件里已写坏的一行（签名与上一行方法体挤在一起），
// 由 STUBS 里新的 toast(Activity, Map) 取代 —— 两者都不参与拆分。
const IGNORED = new Set(['handle', 'toast']);
const methods = scanMethods(source).filter((item) => !IGNORED.has(item.name));

/**
 * static final 字段（正则、序列号等）也要跟着方法一起搬。
 * 漏掉它们就会出现「找不到符号 DATA_URL / FILE_SEQUENCE」。
 */
function scanFields(lines) {
    const fields = [];
    lines.forEach((line, index) => {
        if (!/^\s*(?:private |public |protected )?static\s+final\b/.test(line)) {
            return;
        }
        const name = /static\s+final\s+[\w[\], .<>]+?\s+(\w+)\s*=/.exec(line);
        if (!name) {
            return;
        }
        // 声明可能跨多行，取到分号结束
        let end = index;
        while (end < lines.length && !/;\s*$/.test(lines[end])) {
            end += 1;
        }
        fields.push({ name: name[1], start: index, end });
    });
    return fields;
}

const allFields = scanFields(source);
const FIELD_OWNERS = {
    MediaActions: ['DATA_URL', 'INLINE_IMAGE', 'FILE_SEQUENCE'],
    RegistrationActions: ['REGISTRATION_CODE_PREFIX'],
    WebAppActions: ['TAG'],
};
const fieldByName = new Map(allFields.map((item) => [item.name, item]));

// ── 归属表 ───────────────────────────────────────────────────────

const OWNERS = {
    SessionActions: ['bootstrap', 'userPayload', 'roleKey', 'roleLabel', 'themePayload',
        'uiPayload', 'capabilities', 'reviewPolicy', 'mediaLimits', 'serverSettings',
        'textLimits', 'announcement', 'brand'],
    ProfileActions: ['login', 'register', 'validateUsername', 'validatePassword',
        'validateLength', 'saveProfile', 'changePassword', 'notificationPreferences',
        'saveNotificationPreferences'],
    ExhibitionActions: ['exhibitionPayload', 'exhibitions', 'findExhibition', 'monthPayload',
        'saveExhibition', 'saveExhibitionFields', 'optionsText', 'optionsList', 'fieldsPayload',
        'defaultFields', 'fieldPayloads', 'field', 'descriptionFormatOf', 'saveFields'],
    RegistrationActions: ['registrationStatusLabel', 'registrationPayload', 'myRegistrations',
        'findRegistration', 'submitRegistration', 'autoApprove', 'cancelRegistration',
        'reviewList', 'reviewPayload', 'reviewDetail', 'updateReviewStatus', 'exhibitionTitleOf',
        'registrationCode', 'parseCheckInCode', 'checkIn', 'canCheckInExhibition'],
    AdminActions: ['users', 'adminUserPayload', 'roleFromNickname', 'findUser',
        'findUserByNickname', 'publicProfile', 'search'],
    SystemActions: ['settings', 'saveSettings', 'saveUiMode', 'calendarStatus', 'toggleCalendar',
        'applyCalendarChange', 'requestNotificationPermission', 'ensureCameraPermission',
        'onPermissionResult'],
    MediaActions: ['pickFile', 'imageData', 'importMedia', 'storeDataUrl', 'imageFormatsFor',
        'storeUri', 'inlineDataUrlsToFiles', 'nextFileName', 'writeFile', 'copyToFile',
        'readBytes', 'decodeScaled', 'extensionOf', 'shareText', 'exportCsv', 'onActivityResult',
        'writeCsv'],
    ActionSupport: ['safe', 'registrationMode', 'modeLabel', 'yearOf', 'monthOf', 'dayOf',
        'summarize'],
};

const HEADERS = {
    SessionActions: 'bootstrap 与启动数据：用户态、配色、外观、能力与服务器设置下发。',
    ProfileActions: '登录注册、个人资料、密码与通知偏好。',
    ExhibitionActions: '展会读写、月视图与报名收集项。',
    RegistrationActions: '报名提交与撤销、报名审核、报名二维码与现场核销。',
    AdminActions: '用户管理与用户公开页、搜索。',
    SystemActions: '服务器设置与外观模式、系统日历、通知权限。',
    MediaActions: '媒体落盘、分享、导出，以及系统界面与权限回调。',
    ActionSupport: '跨域共享的结构化输出与工具方法。',
};

/** 原来写在 switch 里、拆分后挪进处理类的薄方法。 */
const STUBS = {
    ProfileActions: `
    /** 访客身份进入：不登录也能浏览公开展会。 */
    static Map<String, Object> enterAsGuest(Activity activity) {
        AuthManager.getInstance().enterAsGuest();
        return SessionActions.userPayload(activity);
    }

    /** 退出登录：清掉当前会话。 */
    static boolean logout() {
        AuthManager.getInstance().logout();
        return true;
    }
`,
    ExhibitionActions: `
    /** 删除展会；归属校验在 ExhibitionManager 内部完成。 */
    static boolean remove(Map<String, Object> payload) {
        return ExhibitionManager.delete(WebAppBridge.text(payload, "id", ""));
    }

    /** 修改报名方式 / 状态。 */
    static boolean updateStatus(Map<String, Object> payload) {
        return ExhibitionManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                WebAppBridge.text(payload, "status", ""));
    }

    /** 展会分类来自服务器设置。 */
    static List<String> categories(Activity activity) {
        return AppSettings.getCategories(activity);
    }
`,
    AdminActions: `
    /** 修改账号状态：正常 / 受限 / 封禁。 */
    static boolean updateStatus(Map<String, Object> payload) {
        return AdminUserManager.updateStatus(WebAppBridge.text(payload, "id", ""),
                WebAppBridge.text(payload, "status", ""));
    }
`,
    MediaActions: `
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
`,
};

/** 动作 → 处理调用；第三个元素为 true 表示处理类自己回调，分发处不再包一层。 */
const DISPATCH = [
    ['bootstrap', 'SessionActions.bootstrap(activity)', false],
    ['auth.login', 'ProfileActions.login(activity, payload)', false],
    ['auth.register', 'ProfileActions.register(activity, payload)', false],
    ['auth.guest', 'ProfileActions.enterAsGuest(activity)', false],
    ['auth.logout', 'ProfileActions.logout()', false],
    ['profile.get', 'SessionActions.userPayload(activity)', false],
    ['profile.save', 'ProfileActions.saveProfile(activity, payload)', false],
    ['profile.password', 'ProfileActions.changePassword(activity, payload)', false],
    ['notify.preferences', 'ProfileActions.notificationPreferences(activity)', false],
    ['notify.savePreferences', 'ProfileActions.saveNotificationPreferences(activity, payload)', true],
    ['exhibitions.list', 'ExhibitionActions.exhibitions(activity, payload)', false],
    ['exhibitions.month', 'ExhibitionActions.monthPayload(activity, payload)', false],
    ['exhibitions.get', 'ExhibitionActions.findExhibition(activity, WebAppBridge.text(payload, "id", ""))', false],
    ['exhibitions.save', 'ExhibitionActions.saveExhibition(activity, payload)', false],
    ['exhibitions.delete', 'ExhibitionActions.remove(payload)', false],
    ['exhibitions.status', 'ExhibitionActions.updateStatus(payload)', false],
    ['exhibitions.categories', 'ExhibitionActions.categories(activity)', false],
    ['exhibitions.fields', 'ExhibitionActions.fieldsPayload(WebAppBridge.text(payload, "id", ""))', false],
    ['exhibitions.saveFields', 'ExhibitionActions.saveFields(WebAppBridge.text(payload, "id", ""), payload)', false],
    ['registrations.list', 'RegistrationActions.myRegistrations(activity)', false],
    ['registrations.get', 'RegistrationActions.findRegistration(activity, WebAppBridge.text(payload, "id", ""))', false],
    ['registrations.submit', 'RegistrationActions.submitRegistration(activity, payload)', false],
    ['registrations.cancel', 'RegistrationActions.cancelRegistration(activity, WebAppBridge.text(payload, "id", ""))', false],
    ['review.list', 'RegistrationActions.reviewList(payload)', false],
    ['review.get', 'RegistrationActions.reviewDetail(WebAppBridge.text(payload, "id", ""))', false],
    ['review.updateStatus', 'RegistrationActions.updateReviewStatus(activity, payload)', false],
    ['checkin.scan', 'RegistrationActions.checkIn(activity, payload)', false],
    ['camera.ensurePermission', 'SystemActions.ensureCameraPermission(bridge, callback)', true],
    ['users.list', 'AdminActions.users(payload)', false],
    ['users.get', 'AdminActions.findUser(WebAppBridge.text(payload, "id", ""))', false],
    ['users.status', 'AdminActions.updateStatus(payload)', false],
    ['users.public', 'AdminActions.publicProfile(activity, payload)', false],
    ['search.query', 'AdminActions.search(activity, WebAppBridge.text(payload, "query", ""))', false],
    ['settings.get', 'SystemActions.settings(activity)', false],
    ['settings.save', 'SystemActions.saveSettings(activity, payload)', false],
    ['settings.uiMode', 'SystemActions.saveUiMode(activity, payload)', false],
    ['calendar.status', 'SystemActions.calendarStatus(activity, payload)', false],
    ['calendar.toggle', 'SystemActions.toggleCalendar(bridge, payload, callback)', true],
    ['notify.requestPermission', 'SystemActions.requestNotificationPermission(bridge, callback)', true],
    ['media.imageData', 'MediaActions.imageData(activity, WebAppBridge.text(payload, "uri", ""))', false],
    ['media.pickImage', 'MediaActions.pickImage(bridge, callback)', true],
    ['media.pickVideo', 'MediaActions.pickVideo(bridge, callback)', true],
    ['media.import', 'MediaActions.importMedia(bridge, payload, callback)', true],
    ['media.store', 'MediaActions.storeDataUrl(activity, payload)', false],
    ['share.text', 'MediaActions.shareText(activity, payload)', true],
    ['export.csv', 'MediaActions.exportCsv(bridge, payload, callback)', true],
    ['toast', 'MediaActions.toast(activity, payload)', false],
];

/** 需要包内可见：跨类调用、分发入口调用，以及上面的薄方法。 */
const PACKAGE_VISIBLE = new Set([
    ...Object.values(OWNERS).flat(),
    ...Object.values(STUBS).flatMap((stub) => [...stub.matchAll(/static\s+[\w[\], .<>]+?\s+(\w+)\(/g)]
        .map((match) => match[1])),
    ...DISPATCH.map(([, call]) => /\.(\w+)\(/.exec(call)?.[1]).filter(Boolean),
    'userPayload', 'pickFile',
].filter(Boolean));

// ── 覆盖校验 ─────────────────────────────────────────────────────

const byName = new Map(methods.map((item) => [item.name, item]));
const assigned = new Set(Object.values(OWNERS).flat());
const found = new Set(methods.map((item) => item.name));
const unassigned = [...found].filter((name) => !assigned.has(name));
const unknown = [...assigned].filter((name) => !found.has(name));

if (unassigned.length > 0 || unknown.length > 0) {
    if (unassigned.length > 0) {
        console.error(`FAIL 以下方法没有分配归属：${unassigned.join(', ')}`);
    }
    if (unknown.length > 0) {
        console.error(`FAIL 归属表里有原文件不存在的方法：${unknown.join(', ')}`);
    }
    process.exit(1);
}
console.log(`扫描到 ${methods.length} 个方法，归属校验通过`);

if (!write) {
    for (const [className, names] of Object.entries(OWNERS)) {
        console.log(`  ${className.padEnd(20)} ${names.length} 个方法`);
    }
    console.log('\n（预演模式：加 --write 才会写入文件）');
    process.exit(0);
}

// ── 生成动作类 ───────────────────────────────────────────────────

const IMPORTS = [
    'android.Manifest', 'android.app.Activity', 'android.content.Context',
    'android.content.Intent', 'android.graphics.Bitmap', 'android.graphics.BitmapFactory',
    'android.net.Uri', 'android.os.Build', 'android.util.Base64', 'android.util.Log', '',
    'java.io.ByteArrayOutputStream', 'java.io.InputStream', 'java.util.ArrayList',
    'java.util.Arrays', 'java.util.LinkedHashMap', 'java.util.List', 'java.util.Map',
];

/** 类名 → 它自己拥有的方法集合，用于避免给「自己的方法」加类名前缀。 */
const OWN_METHODS = Object.fromEntries(
    Object.entries(OWNERS).map(([className, names]) => [className, new Set(names)]),
);

for (const [className, names] of Object.entries(OWNERS)) {
    // 本类需要携带的 static final 字段
    const fieldNames = FIELD_OWNERS[className] || [];
    const fieldCode = fieldNames
        .filter((name) => fieldByName.has(name))
        .map((name) => {
            const field = fieldByName.get(name);
            return source.slice(field.start, field.end + 1).join('\n');
        }).join('\n\n');

    let code = names.map((name) => {
        const method = byName.get(name);
        return source.slice(method.start, method.end + 1).join('\n');
    }).join('\n\n');

    // 放宽可见性（只动签名行）。
    // 注意：返回类型里不能含 `(`，否则 `String safe(String` 会被整体吃掉 —— 之前写成
    // `[\w[\], .<>]+?` 就把 `(String ` 一起吞了，签名只剩 `safe(`。
    code = code.split('\n').map((line) => {
        const match = /^(\s*)private static ([\w[\], .<>]+?\s+)(\w+)\(/.exec(line);
        if (match && PACKAGE_VISIBLE.has(match[3])) {
            return `${match[1]}static ${match[2]}${match[3]}${line.slice(match[0].length - 1)}`;
        }
        return line;
    }).join('\n');

    // 跨类调用补类名前缀：跳过定义行、注释行，以及本类自己拥有的方法
    // （第一版没排除「自己」，`safe(` 被改成了 `ActionSupport.safe(`，签名当场写坏）
    code = code.split('\n').map((line) => {
        const text = line.trim();
        if (text.startsWith('*') || text.startsWith('//') || text.startsWith('/*')) {
            return line;
        }
        if (/^(static|final|private|public|protected)\b/.test(text)) {
            return line;
        }
        let out = line;
        for (const [owner, ownerMethods] of Object.entries(OWNERS)) {
            if (owner === className) {
                continue;
            }
            for (const method of ownerMethods) {
                if (OWN_METHODS[className].has(method)) {
                    continue;
                }
                out = out.replace(new RegExp(`(?<![.\\w])${method}\\(`, 'g'), `${owner}.${method}(`);
            }
        }
        return out;
    }).join('\n');

    const usesLog = /\bLog\./.test(code);
    const header = `package com.example.calmobile;\n\n`
        + IMPORTS.map((line) => (line === '' ? '' : `import ${line};`)).join('\n')
        + `\n\n/**\n * ${HEADERS[className]}\n * <p>\n`
        + ` * 由 {@link WebAppActions} 分发调用；方法体与拆分前一致，仅调整了所在类与可见性。\n`
        + ` */\nfinal class ${className} {\n\n`
        + (usesLog && !(FIELD_OWNERS[className] || []).includes('TAG')
            ? `    private static final String TAG = "WebAppActions";\n\n` : '')
        + `    private ${className}() {\n    }\n\n`;
    const stub = STUBS[className] || '';
    const fields = fieldCode ? `${fieldCode}\n\n` : '';
    fs.writeFileSync(path.join(javaDir, `${className}.java`), `${header}${fields}${code}${stub}}\n`);
    console.log(`  ${className.padEnd(20)} ${names.length} 个方法`
        + `${stub ? ` + 薄方法` : ''}`);
}

// ── 分发入口 ─────────────────────────────────────────────────────

const cases = DISPATCH.map(([action, call, selfCallback]) => (selfCallback
    ? `            case "${action}":\n                ${call};\n                return;`
    : `            case "${action}":\n                callback.success(${call});\n                return;`)).join('\n');

const dispatcher = `package com.example.calmobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

import java.util.Map;

/**
 * 桥接动作分发入口。
 * <p>
 * 这里只做「动作名 → 处理类」的路由，实现按域拆到：
 * {@link SessionActions}（启动数据）、{@link ProfileActions}（认证与资料）、
 * {@link ExhibitionActions}（展会）、{@link RegistrationActions}（报名与核销）、
 * {@link AdminActions}（用户与搜索）、{@link MediaActions}（媒体与导出）、
 * {@link SystemActions}（设置与系统能力），共享工具在 {@link ActionSupport}。
 * <p>
 * 前端只认动作名，因此拆分不影响 {@code js/core/api.js} 的接口形状；
 * 接后端时按域替换对应处理类即可，不必再读一个两千行的文件。
 */
final class WebAppActions {

    private WebAppActions() {
    }

    static void handle(WebAppBridge bridge, String action, Map<String, Object> payload,
            WebAppBridge.ResultCallback callback) {
        Activity activity = bridge.activity();
        DatabaseHelper.init(activity);
        ExhibitionManager.ensureInitialized();
        AdminUserManager.ensureInitialized();

        switch (action) {
${cases}
            default:
                callback.failure("未实现的动作：" + action);
        }
    }

    // ── 供 WebAppBridge 与测试直接调用 ─────────────────────────────

    /** 系统界面（文件选择、导出 CSV）返回结果。 */
    static void onActivityResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            int resultCode, Intent data) {
        MediaActions.onActivityResult(bridge, pending, resultCode, data);
    }

    /** 权限申请结果：日历与摄像头在这里分流。 */
    static void onPermissionResult(WebAppBridge bridge, WebAppBridge.PendingResult pending,
            boolean granted) {
        SystemActions.onPermissionResult(bridge, pending, granted);
    }

    /** 把简介里的内联 base64 图片改写成落盘后的短 URL。 */
    static String inlineDataUrlsToFiles(Context context, String description) {
        return MediaActions.inlineDataUrlsToFiles(context, description);
    }

    /** 报名码：报名详情页展示、展商扫码核销共用同一份内容。 */
    static String registrationCode(String exhibitionId, String recordId) {
        return RegistrationActions.registrationCode(exhibitionId, recordId);
    }

    /** 展会结构：{@link ExhibitionActions} 输出给前端，测试也直接调用。 */
    static Map<String, Object> exhibitionPayload(Activity activity, ExhibitorExhibition exhibition) {
        return ExhibitionActions.exhibitionPayload(activity, exhibition);
    }
}
`;

fs.writeFileSync(path.join(javaDir, 'WebAppActions.java'), dispatcher);
console.log(`\nWebAppActions.java: ${source.length} 行 → `
    + `${dispatcher.split('\n').length} 行（分发 ${DISPATCH.length} 个动作）`);
