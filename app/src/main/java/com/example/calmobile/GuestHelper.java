package com.example.calmobile;

/**
 * 访客状态辅助类，统一封装未登录访问判断。
 */
public final class GuestHelper {

    private GuestHelper() { }

    public static boolean isGuest() {
        return AuthManager.getInstance().isGuest();
    }

    public static boolean isLoggedIn() {
        return AuthManager.getInstance().isLoggedIn();
    }

    public static void enterAsGuest() {
        AuthManager.getInstance().enterAsGuest();
    }
}
