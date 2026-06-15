package com.example.calmobile.database;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import com.example.calmobile.models.Exhibition;
import com.example.calmobile.models.Registration;
import com.example.calmobile.models.User;

/**
 * Room 数据库类
 * 管理本地数据存储
 */
@Database(entities = {Exhibition.class, User.class, Registration.class}, version = 1, exportSchema = false)
public abstract class AppDatabase extends RoomDatabase {

    private static final String DATABASE_NAME = "calmobile_db";
    private static volatile AppDatabase instance;

    /**
     * 获取数据库单例
     * @param context 上下文
     * @return 数据库实例
     */
    public static AppDatabase getInstance(Context context) {
        if (instance == null) {
            synchronized (AppDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                            context.getApplicationContext(),
                            AppDatabase.class,
                            DATABASE_NAME)
                            .fallbackToDestructiveMigration()
                            .build();
                }
            }
        }
        return instance;
    }

    /**
     * 获取展会 DAO
     * @return 展会 DAO
     */
    public abstract ExhibitionDao exhibitionDao();

    /**
     * 获取用户 DAO
     * @return 用户 DAO
     */
    public abstract UserDao userDao();

    /**
     * 获取报名 DAO
     * @return 报名 DAO
     */
    public abstract RegistrationDao registrationDao();
}
