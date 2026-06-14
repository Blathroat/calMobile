package com.example.calmobile;

/**
 * 权限辅助类，集中管理 demo 角色权限判断。
 */
public final class PermissionHelper {

    public static final String PERMISSION_PROFILE = "profile";
    public static final String PERMISSION_REGISTER = "register";
    public static final String PERMISSION_EXHIBITOR = "exhibitor";
    public static final String PERMISSION_ADMIN = "admin";

    private PermissionHelper() { }

    public static boolean hasPermission(String permission) {
        AuthManager auth = AuthManager.getInstance();
        if (PERMISSION_PROFILE.equals(permission)) {
            return auth.canAccessProfile();
        }
        if (PERMISSION_REGISTER.equals(permission)) {
            return auth.canRegisterForExhibitions();
        }
        if (PERMISSION_EXHIBITOR.equals(permission)) {
            return auth.canAccessExhibitor();
        }
        if (PERMISSION_ADMIN.equals(permission)) {
            return auth.canAccessAdmin();
        }
        return false;
    }

    public static boolean canAccessProfile() {
        return hasPermission(PERMISSION_PROFILE);
    }

    public static boolean canRegisterForExhibitions() {
        return hasPermission(PERMISSION_REGISTER);
    }

    public static boolean canAccessExhibitor() {
        return hasPermission(PERMISSION_EXHIBITOR);
    }

    public static boolean canAccessAdmin() {
        return hasPermission(PERMISSION_ADMIN);
    }
}
