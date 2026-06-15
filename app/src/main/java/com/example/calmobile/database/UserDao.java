package com.example.calmobile.database;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;

import com.example.calmobile.models.User;

import java.util.List;

/**
 * 用户数据访问对象
 * 定义用户表的数据库操作
 */
@Dao
public interface UserDao {

    /**
     * 获取所有用户（按注册时间排序）
     * @return 用户列表
     */
    @Query("SELECT * FROM users ORDER BY registration_time DESC")
    LiveData<List<User>> getAllUsers();

    /**
     * 按状态获取用户
     * @param status 状态
     * @return 用户列表
     */
    @Query("SELECT * FROM users WHERE status = :status ORDER BY registration_time DESC")
    LiveData<List<User>> getUsersByStatus(String status);

    /**
     * 搜索用户
     * @param query 搜索关键词
     * @return 用户列表
     */
    @Query("SELECT * FROM users WHERE username LIKE '%' || :query || '%' OR email LIKE '%' || :query || '%' OR nickname LIKE '%' || :query || '%' ORDER BY registration_time DESC")
    LiveData<List<User>> searchUsers(String query);

    /**
     * 获取单个用户
     * @param id 用户 ID
     * @return 用户
     */
    @Query("SELECT * FROM users WHERE id = :id")
    LiveData<User> getUserById(String id);

    /**
     * 获取单个用户（同步）
     * @param id 用户 ID
     * @return 用户
     */
    @Query("SELECT * FROM users WHERE id = :id")
    User getUserByIdSync(String id);

    /**
     * 按用户名获取用户
     * @param username 用户名
     * @return 用户
     */
    @Query("SELECT * FROM users WHERE username = :username")
    User getUserByUsername(String username);

    /**
     * 按邮箱获取用户
     * @param email 邮箱
     * @return 用户
     */
    @Query("SELECT * FROM users WHERE email = :email")
    User getUserByEmail(String email);

    /**
     * 获取用户数量
     * @return 用户数量
     */
    @Query("SELECT COUNT(*) FROM users")
    int getUserCount();

    /**
     * 按状态获取用户数量
     * @param status 状态
     * @return 用户数量
     */
    @Query("SELECT COUNT(*) FROM users WHERE status = :status")
    int getUserCountByStatus(String status);

    /**
     * 插入用户
     * @param user 用户
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insert(User user);

    /**
     * 批量插入用户
     * @param users 用户列表
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertAll(List<User> users);

    /**
     * 更新用户
     * @param user 用户
     */
    @Update
    void update(User user);

    /**
     * 删除用户
     * @param user 用户
     */
    @Delete
    void delete(User user);

    /**
     * 按 ID 删除用户
     * @param id 用户 ID
     */
    @Query("DELETE FROM users WHERE id = :id")
    void deleteById(String id);

    /**
     * 删除所有用户
     */
    @Query("DELETE FROM users")
    void deleteAll();
}
