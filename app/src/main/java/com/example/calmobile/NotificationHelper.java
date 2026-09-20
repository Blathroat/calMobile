package com.example.calmobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;

/**
 * 通知渠道与通知权限。
 *
 * 通知的**内容与触发**现在不属于客户端：报名审核、核销这些事件发生在服务端，
 * 客户端只能申请权限、把渠道准备好，等后端接入推送通道后再投递
 * （服务端已有 `notification_preferences` 表保存用户的开关）。
 *
 * 因此这里只保留两件事：建渠道（Android 8+ 必须先有渠道才能发通知）与查询权限状态。
 */
public final class NotificationHelper {

    private static final String CHANNEL_EXHIBITION_REMINDER = "exhibition_reminder";
    private static final String CHANNEL_REGISTRATION_UPDATE = "registration_update";
    private static final String CHANNEL_NAME_EXHIBITION = "展会提醒";
    private static final String CHANNEL_NAME_REGISTRATION = "报名动态";

    private static NotificationHelper instance;
    private final Context appContext;

    private NotificationHelper(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static synchronized NotificationHelper getInstance(Context context) {
        if (instance == null) {
            instance = new NotificationHelper(context);
        }
        return instance;
    }

    /** 建通知渠道；重复调用安全（同名渠道只会创建一次）。 */
    public void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = appContext.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel exhibition = new NotificationChannel(
                CHANNEL_EXHIBITION_REMINDER, CHANNEL_NAME_EXHIBITION, NotificationManager.IMPORTANCE_HIGH);
        exhibition.setDescription("展会开展前一天的提醒通知");
        exhibition.enableLights(true);
        exhibition.setLightColor(Color.GREEN);
        exhibition.enableVibration(true);
        manager.createNotificationChannel(exhibition);

        NotificationChannel registration = new NotificationChannel(
                CHANNEL_REGISTRATION_UPDATE, CHANNEL_NAME_REGISTRATION, NotificationManager.IMPORTANCE_DEFAULT);
        registration.setDescription("报名审核状态变更通知");
        registration.enableLights(true);
        registration.setLightColor(Color.BLUE);
        registration.enableVibration(true);
        manager.createNotificationChannel(registration);
    }

    /** POST_NOTIFICATIONS 是否已授权；Android 13 以下不需要该权限，恒为 true。 */
    public boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return appContext.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }
}
