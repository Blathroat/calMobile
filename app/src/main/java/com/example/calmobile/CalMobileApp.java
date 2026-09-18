package com.example.calmobile;

import android.app.Application;

/**
 * 应用启动时的原生初始化。
 *
 * 业务数据（展会、报名、用户）现在由 `server/` 的后端提供，原生不再初始化任何数据库；
 * 这里只建通知渠道（Android 8+ 需要在发通知前创建，提前建好可以让权限弹窗更自然）。
 */
public class CalMobileApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        NotificationHelper.getInstance(this).createNotificationChannels();
    }
}
