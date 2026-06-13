package com.example.calmobile;

import android.app.Application;

/**
 * Custom Application class that initializes the SQLite database singleton
 * before any Activity runs.
 */
public class CalMobileApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        DatabaseHelper.init(this);
        NotificationHelper.getInstance(this).createNotificationChannels();
    }
}
