/**
 * 逐屏文案对照（旧 runtime 分支 → 当前 Vue 页面）。
 *
 * 重构前每个页面的用户可见区块都对应一组 `t('s_xxx')`；新页面缺哪个 key，就说明
 * 那一块还没搬过来（或已经被有意替换）。这是「逐屏回归」里最快能跑、也最客观的一步：
 * 它不会告诉你像素对不对，但能告诉你**有没有整块丢失**。
 *
 * 用法：
 *   node scripts/ui-parity.mjs                     # 默认与 master 对照
 *   node scripts/ui-parity.mjs --ref 5e3d9ab^      # 指定参考提交
 *   node scripts/ui-parity.mjs --full              # 打印每条缺失文案
 *
 * 输出里 `→ 别处` 表示该 key 在当前仓库其它文件里仍在使用（例如路由 meta 的标题、
 * 由共享服务提供的文案），不算缺口；`→ 无` 才是真的没了。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 旧页面模块 → 现在的 Vue 页面（一个旧页面可能拆成多页，用 `+` 连接）。 */
const PAIRS = [
  ['pages/login.js', 'web/src/pages/LoginPage.vue'],
  ['pages/register.js', 'web/src/pages/RegisterPage.vue'],
  ['pages/forgot-password.js', 'web/src/pages/ForgotPasswordPage.vue'],
  ['pages/home.js', 'web/src/pages/HomePage.vue'],
  ['pages/detail.js', 'web/src/pages/DetailPage.vue'],
  ['pages/registration-form.js', 'web/src/pages/RegistrationFormPage.vue'],
  ['pages/search.js', 'web/src/pages/SearchPage.vue'],
  ['pages/my-registrations.js', 'web/src/pages/MyRegistrationsPage.vue'],
  ['pages/registration-detail.js', 'web/src/pages/RegistrationDetailPage.vue'],
  // 安全与外观在旧版内联在个人页，现在拆成个人页 + 用户设置页 + 安全设置页
  ['pages/profile.js', 'web/src/pages/ProfilePage.vue + web/src/pages/UserSettingsPage.vue + web/src/pages/SecurityPage.vue'],
  ['pages/exhibitor.js', 'web/src/pages/ExhibitorPage.vue'],
  ['pages/exhibition-form.js', 'web/src/pages/ExhibitionFormPage.vue'],
  ['pages/rich-editor.js', 'web/src/pages/RichEditorPage.vue'],
  ['pages/review.js', 'web/src/pages/ReviewPage.vue'],
  ['pages/user-public.js', 'web/src/pages/UserPublicPage.vue'],
  ['pages/admin.js', 'web/src/pages/AdminPage.vue'],
  ['pages/checkin.js', 'web/src/pages/CheckinPage.vue'],
];

const args = process.argv.slice(2);
const refIndex = args.indexOf('--ref');
const REF = refIndex >= 0 ? args[refIndex + 1] : 'master';
const FULL = args.includes('--full');
/**
 * 「别处也没有」的 key 数量上限（`--max-gone N`）。
 * 存量里有二十来条是**有意删除**的（保存配色、报名方式抽屉、账号状态说明、EasyMDE 相关…），
 * 因此 CI 用它做预算：整块文案消失会让数量跳变并让构建失败，个别调整则在预算内。
 */
const maxIndex = args.indexOf('--max-gone');
const MAX_GONE = maxIndex >= 0 ? Number(args[maxIndex + 1]) : Number.POSITIVE_INFINITY;
const SHOULD_SHOW = (key) => FULL || FULL_KEYS.has(key);

const T_CALL = /\bt\(\s*(['"])(s_[a-z0-9]+)\1\s*\)/g;
const KEY_LITERAL = /(['"])(s_[a-z0-9]+)\1/g;

function keysIn(source) {
  const keys = new Set();
  for (const pattern of [T_CALL, KEY_LITERAL]) {
    for (const match of source.matchAll(pattern)) keys.add(match[2]);
  }
  return keys;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? walk(path.join(dir, entry.name))
    : (/\.(ts|vue)$/.test(entry.name) ? [path.join(dir, entry.name)] : [])));
}

const xml = fs.readFileSync('app/src/main/res/values/strings_frontend.xml', 'utf8');
const textOf = new Map();
for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) textOf.set(match[1], match[2]);

/** 全仓库在用的 key（含路由 meta 与共享服务），用来区分「搬到别处」与「真的没了」。 */
const usedElsewhere = new Map();
for (const file of walk('web/src')) {
  const source = fs.readFileSync(file, 'utf8');
  for (const key of keysIn(source)) {
    if (!usedElsewhere.has(key)) usedElsewhere.set(key, path.relative('.', file));
  }
}

// 只在 --full 时逐条打印；默认只列出「真的没了」的 key，避免被标题类差异淹掉。
const FULL_KEYS = new Set();

let missingTotal = 0;
const rows = [];
for (const [oldFile, newFiles] of PAIRS) {
  const reference = spawnSync('git', ['show', `${REF}:app/src/main/assets/web/js/${oldFile}`], { encoding: 'utf8' }).stdout;
  if (!reference) {
    rows.push({ screen: oldFile, note: `参考提交里没有这个文件（--ref ${REF}？）` });
    continue;
  }
  const newPaths = newFiles.split(' + ');
  const current = newPaths.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const oldKeys = keysIn(reference);
  const newKeys = keysIn(current);
  const missing = [...oldKeys].filter((key) => !newKeys.has(key));
  const gone = missing.filter((key) => !usedElsewhere.has(key));
  missingTotal += gone.length;
  rows.push({
    screen: `${oldFile} → ${newFiles}`,
    counts: `${oldKeys.size} → ${newKeys.size}`,
    missing,
    gone,
  });
}

console.log(`对照参考：${REF}（app/src/main/assets/web/js/pages/*.js）\n`);
for (const row of rows) {
  if (row.note) {
    console.log(`== ${row.screen}\n   ${row.note}`);
    continue;
  }
  const head = `== ${row.screen}\n   文案 ${row.counts}，未在新页面出现 ${row.missing.length} 条（其中别处也没有 ${row.gone.length} 条）`;
  console.log(head);
  for (const key of row.missing) {
    const where = usedElsewhere.get(key);
    if (!SHOULD_SHOW(key) && where) continue;
    console.log(`   - ${key}  ${textOf.get(key) ?? '（资源里没有）'}  → ${where ?? '无'}`);
  }
}
console.log(`\n合计「别处也没有」的 key：${missingTotal} 条。`);
console.log('提示：`→ 无` 才是真缺口；`→ web/src/...` 表示搬到了路由 meta 或共享服务/组件里。');

const unresolved = rows.filter((row) => row.note).length;
if (unresolved > 0) {
  console.warn(`\n注意：${unresolved} 个页面没能取到参考实现（${REF}），对照不完整。`);
}
if (unresolved === rows.length) {
  console.error('FAIL 参考提交完全取不到：先 `git fetch origin master`，或用 --ref 指定可解析的提交。');
  process.exitCode = 1;
} else if (missingTotal > MAX_GONE) {
  console.error(`FAIL 「别处也没有」的文案有 ${missingTotal} 条，超过预算 ${MAX_GONE} 条：可能有整块界面没搬过来。`);
  process.exitCode = 1;
}
