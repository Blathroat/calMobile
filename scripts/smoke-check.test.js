const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  findLauncherActivities,
  validateLauncherManifest
} = require('./smoke-check');

const manifestPath = 'app/src/main/AndroidManifest.xml';
const manifest = fs.readFileSync(manifestPath, 'utf8');

test('finds LoginActivity as the only launcher in the real manifest', () => {
  assert.deepEqual(findLauncherActivities(manifest), ['.LoginActivity']);
  assert.equal(validateLauncherManifest(manifest), true);
});

test('does not confuse MainActivity with the launcher', () => {
  const xml = `<manifest package="com.example.calmobile"><application>
    <activity android:name=".MainActivity" android:exported="false">
      <meta-data android:name="android.intent.action.MAIN" />
      <meta-data android:name="android.intent.category.LAUNCHER" />
    </activity>
    <activity android:name=".LoginActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.LoginActivity']);
  assert.equal(validateLauncherManifest(xml), true);
});

test('requires MAIN and LAUNCHER in the same intent filter', () => {
  const xml = `<manifest><application>
    <activity android:name=".LoginActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
      <intent-filter><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), []);
  assert.equal(validateLauncherManifest(xml), false);
});

test('rejects multiple launcher activities', () => {
  const xml = `<manifest><application>
    <activity android:name=".LoginActivity" android:exported="true"><intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter></activity>
    <activity android:name=".OtherActivity" android:exported="true"><intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter></activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.LoginActivity', '.OtherActivity']);
  assert.equal(validateLauncherManifest(xml), false);
});

test('handles multiline attributes and arbitrary attribute order', () => {
  const xml = `<manifest><application>
    <activity
      android:exported="true"
      android:name='.LoginActivity'
    >
      <intent-filter>
        <category android:name='android.intent.category.LAUNCHER' />
        <action android:name='android.intent.action.MAIN' />
      </intent-filter>
    </activity>
  </application></manifest>`;

  assert.deepEqual(findLauncherActivities(xml), ['.LoginActivity']);
  assert.equal(validateLauncherManifest(xml), true);
});

test('does not trust exported attributes inside comments', () => {
  const xml = `<!-- <activity android:name=".LoginActivity" android:exported="true" /> -->
    <manifest><application><activity android:name=".LoginActivity" android:exported="false">
      <intent-filter><action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" /></intent-filter>
    </activity></application></manifest>`;

  assert.equal(validateLauncherManifest(xml), false);
});
