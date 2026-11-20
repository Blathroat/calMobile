package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 服务端下发选项 JSON 的本地校验。
 *
 * 这些分支是「闪退/英文报错」的第一道闸：以前页面把选项原样交给 system credentials，
 * 不合法的 JSON 会在系统侧抛英文 IllegalArgumentException；现在不合法的输入在本地
 * 就被翻成中文说明，而且不会走到构造请求那一步。这里钉住的正是「哪些输入必须被挡」。
 */
public class PasskeyOptionsTest {

    /** 一份完整的注册选项（形状抄自 @simplewebauthn/server 的 generateRegistrationOptions）。 */
    private static final String VALID_CREATE = "{"
            + "\"challenge\":\"aGVsbG8\"," 
            + "\"rp\":{\"id\":\"example.com\",\"name\":\"展会排期助手\"},"
            + "\"user\":{\"id\":\"dXNlcg\",\"name\":\"a@b.c\",\"displayName\":\"演示账号\"},"
            + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}],"
            + "\"timeout\":60000,"
            + "\"excludeCredentials\":[],"
            + "\"authenticatorSelection\":{\"residentKey\":\"preferred\",\"userVerification\":\"preferred\"}"
            + "}";

    /** 一份完整的断言选项（形状抄自 generateAuthenticationOptions）。 */
    private static final String VALID_GET = "{"
            + "\"challenge\":\"aGVsbG8\","
            + "\"rpId\":\"example.com\","
            + "\"timeout\":60000,"
            + "\"allowCredentials\":[{\"id\":\"aGVsbG8\",\"type\":\"public-key\"}],"
            + "\"userVerification\":\"preferred\""
            + "}";

    /** 完整选项必须放行。 */
    @Test
    public void acceptsCompleteOptions() {
        assertNull(PasskeyActions.Options.createError(VALID_CREATE));
        assertNull(PasskeyActions.Options.getError(VALID_GET));
    }

    /** 空、空白、null：在本地就说清「缺选项」，不要等系统抛英文异常。 */
    @Test
    public void rejectsMissingOptions() {
        assertNotNull(PasskeyActions.Options.createError(""));
        assertNotNull(PasskeyActions.Options.createError("   "));
        assertNotNull(PasskeyActions.Options.createError(null));
        assertNotNull(PasskeyActions.Options.getError(""));
        assertNotNull(PasskeyActions.Options.getError(null));
    }

    /** 不是 JSON 对象（null / 数组 / 字符串 / 残缺 JSON）一律挡掉。 */
    @Test
    public void rejectsNonObjectJson() {
        for (String bad : new String[] { "null", "[]", "\"text\"", "{", "{\"challenge\":}" }) {
            assertNotNull("应拒绝：" + bad, PasskeyActions.Options.createError(bad));
            assertNotNull("应拒绝：" + bad, PasskeyActions.Options.getError(bad));
        }
    }

    /** 超长选项直接拒绝：正常 WebAuthn 选项只有 2KB 上下，32KB 以上只可能是服务端拼错了。 */
    @Test
    public void rejectsOverlongOptions() {
        StringBuilder huge = new StringBuilder(PasskeyActions.Options.MAX_LENGTH + 1);
        huge.append("{\"challenge\":\"");
        while (huge.length() <= PasskeyActions.Options.MAX_LENGTH) {
            huge.append('a');
        }
        huge.append("\"}");
        assertNotNull(PasskeyActions.Options.createError(huge.toString()));
        assertNotNull(PasskeyActions.Options.getError(huge.toString()));
    }

    /** 注册选项缺 challenge / rp.id / user / 算法列表时分别给出可照着做的说明。 */
    @Test
    public void rejectsIncompleteCreationOptions() {
        assertNotNull(PasskeyActions.Options.createError("{\"rp\":{\"id\":\"example.com\"}}"));
        assertNotNull(PasskeyActions.Options.createError(
                "{\"challenge\":\"x\",\"user\":{\"id\":\"dXNlcg\",\"name\":\"a@b.c\"},"
                        + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}"));
        assertNotNull(PasskeyActions.Options.createError(
                "{\"challenge\":\"x\",\"rp\":{\"id\":\"example.com\"},"
                        + "\"user\":{\"id\":\"dXNlcg\"},"
                        + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}"));
        assertNotNull(PasskeyActions.Options.createError(
                "{\"challenge\":\"x\",\"rp\":{\"id\":\"example.com\"},"
                        + "\"user\":{\"id\":\"dXNlcg\",\"name\":\"a@b.c\"},"
                        + "\"pubKeyCredParams\":[]}"));
        // user.id 是数字 / user.name 是空白：都不算有效账号信息
        assertNotNull(PasskeyActions.Options.createError(
                "{\"challenge\":\"x\",\"rp\":{\"id\":\"example.com\"},"
                        + "\"user\":{\"id\":42,\"name\":\"  \"},"
                        + "\"pubKeyCredParams\":[{\"type\":\"public-key\",\"alg\":-7}]}"));
    }

    /** 断言选项缺 challenge / rpId 时同样挡掉；allowCredentials 允许为空。 */
    @Test
    public void rejectsIncompleteRequestOptions() {
        assertNotNull(PasskeyActions.Options.getError("{\"rpId\":\"example.com\"}"));
        assertNotNull(PasskeyActions.Options.getError("{\"challenge\":\"x\"}"));
        assertNull(PasskeyActions.Options.getError(
                "{\"challenge\":\"x\",\"rpId\":\"example.com\",\"allowCredentials\":[]}"));
    }

    /** 错误文案必须是能照着做的中文，不能把系统英文或类名漏给用户。 */
    @Test
    public void errorsAreReadableChinese() {
        String[] messages = {
                PasskeyActions.Options.createError(""),
                PasskeyActions.Options.createError("[]"),
                PasskeyActions.Options.createError("{\"challenge\":\"x\"}"),
                PasskeyActions.Options.getError(""),
        };
        for (String message : messages) {
            assertNotNull(message);
            boolean chinese = false;
            for (int index = 0; index < message.length(); index++) {
                if (message.charAt(index) >= 0x4e00 && message.charAt(index) <= 0x9fff) {
                    chinese = true;
                    break;
                }
            }
            assertTrue("错误文案要是中文：" + message, chinese);
        }
    }
}
