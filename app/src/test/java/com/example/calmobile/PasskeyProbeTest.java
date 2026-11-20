package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 通行密钥可用性判定。
 *
 * 旧实现只调 CredentialManager.create() 就回 supported=true —— 那只是拿到一个门面对象，
 * 设备上有没有凭据提供方根本没问。这里按 androidx.credentials 1.3.0 的 provider 选择规则
 * （见 CredentialProviderFactory / isAvailableOnDevice）钉住三个分支：
 * API 34+ 看系统 credential 服务并保留 Play 服务兜底；API 33 及以下只看 Play 服务提供方。
 *
 * 设备侧真正的读取（系统服务、GMS 检查器）在 PasskeyActions.Probe.supported(Context)，
 * 这里只测不碰 Android 的判定函数与那条最低 GMS 版本契约。
 */
public class PasskeyProbeTest {

    private static final long MIN_GMS = PasskeyActions.Probe.MIN_GMS_APK_VERSION;

    /** API 34+ 有系统 credential 服务就算可用（Android 14 的框架提供方）。 */
    @Test
    public void frameworkProviderIsAvailableOnAndroid14() {
        assertTrue(PasskeyActions.Probe.supportedFromSignals(34, true, false));
        assertTrue(PasskeyActions.Probe.supportedFromSignals(36, true, false));
        assertFalse(PasskeyActions.Probe.supportedFromSignals(34, false, false));
    }

    /** 框架服务缺席时，API 34+ 仍会退回随包的 Play 服务提供方。 */
    @Test
    public void playServicesProvideFallbackOnAndroid14() {
        assertTrue(PasskeyActions.Probe.supportedFromSignals(34, false, true));
    }

    /** API 33 及以下没有框架兜底：Play 服务不可用就是不可用。 */
    @Test
    public void oldDevicesRequirePlayServices() {
        assertTrue(PasskeyActions.Probe.supportedFromSignals(33, false, true));
        assertTrue(PasskeyActions.Probe.supportedFromSignals(24, false, true));
        assertFalse(PasskeyActions.Probe.supportedFromSignals(33, false, false));
        // 低版本即使系统里查得到 credential 服务名，也没有框架提供方实现
        assertFalse(PasskeyActions.Probe.supportedFromSignals(33, true, false));
        assertFalse(PasskeyActions.Probe.supportedFromSignals(24, false, false));
    }

    /** 最低 GMS 版本跟着 androidx 走：改动它等于改「哪些设备显示入口」。 */
    @Test
    public void minGmsVersionMatchesCredentialManagerContract() {
        assertEquals(230815045L, PasskeyActions.Probe.MIN_GMS_APK_VERSION);
        assertTrue(PasskeyActions.Probe.packageVersionSupported(230815045L));
        assertFalse(PasskeyActions.Probe.packageVersionSupported(230815044L));
        assertFalse(PasskeyActions.Probe.packageVersionSupported(0));
        assertTrue(PasskeyActions.Probe.packageVersionSupported(MIN_GMS));
    }
}
