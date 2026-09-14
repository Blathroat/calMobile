/**
 * smoke-check 中启动入口解析的单元测试。
 *
 * 运行方式（仓库根目录）：node --test scripts/smoke-check.test.js
 * 当前启动页是 WebShellActivity，旧页面全部归档在 legacy/ 且不再导出。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  findLauncherActivities,
  validateLauncherManifest
} = require('./smoke-check');

const root = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');

test('finds WebShellActivity as the only launcher in the real manifest', () => {
  assert.deepEqual(findLauncherActivities(manifest), ['.WebShellActivity']);
  assert.equal(validateLauncherManifest(manifest), true);
});

test('does not confuse MainActivity with the launcher', () => {
  const xml = `<manifest package="com.example.calmobile"><application>
    <activity android:name=".MainActivity" android:exported="false">
      <meta-data android:name="android.intent.action.MAIN" />
      <meta-data android:name="android.intent.category.LAUNCHER" />
    </activity>
    <activity android:name=".WebShellActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.WebShellActivity']);
  assert.equal(validateLauncherManifest(xml), true);
});

test('requires MAIN and LAUNCHER in the same intent filter', () => {
  const xml = `<manifest><application>
    <activity android:name=".WebShellActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
      <intent-filter><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), []);
  assert.equal(validateLauncherManifest(xml), false);
});

test('rejects multiple launcher activities', () => {
  const xml = `<manifest><application>
    <activity android:name=".WebShellActivity" android:exported="true"><intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter></activity>
    <activity android:name=".OtherActivity" android:exported="true"><intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter></activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.WebShellActivity', '.OtherActivity']);
  assert.equal(validateLauncherManifest(xml), false);
});

test('handles multiline attributes and arbitrary attribute order', () => {
  const xml = `<manifest><application>
    <activity
      android:exported="true"
      android:name='.WebShellActivity'
    >
      <intent-filter>
        <category android:name='android.intent.category.LAUNCHER' />
        <action android:name='android.intent.action.MAIN' />
      </intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.WebShellActivity']);
  assert.equal(validateLauncherManifest(xml), true);
});

test('does not trust exported attributes inside comments', () => {
  const xml = `<!-- <activity android:name=".WebShellActivity" android:exported="true" /> -->
    <manifest><application><activity android:name=".WebShellActivity" android:exported="false">
      <intent-filter><action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity></application></manifest>`;

  assert.equal(validateLauncherManifest(xml), false);
});
