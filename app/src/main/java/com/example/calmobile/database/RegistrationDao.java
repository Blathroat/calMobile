package com.example.calmobile.database;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;

import com.example.calmobile.models.Registration;

import java.util.List;

/**
 * 报名数据访问对象
 * 定义报名表的数据库操作
 */
@Dao
public interface RegistrationDao {

    /**
     * 获取所有报名（按创建时间排序）
     * @return 报名列表
     */
    @Query("SELECT * FROM registrations ORDER BY created_at DESC")
    LiveData<List<Registration>> getAllRegistrations();

    /**
     * 按展会获取报名
     * @param exhibitionId 展会 ID
     * @return 报名列表
     */
    @Query("SELECT * FROM registrations WHERE exhibition_id = :exhibitionId ORDER BY created_at DESC")
    LiveData<List<Registration>> getRegistrationsByExhibition(String exhibitionId);

    /**
     * 按访客获取报名
     * @param visitorId 访客 ID
     * @return 报名列表
     */
    @Query("SELECT * FROM registrations WHERE visitor_id = :visitorId ORDER BY created_at DESC")
    LiveData<List<Registration>> getRegistrationsByVisitor(String visitorId);

    /**
     * 按状态获取报名
     * @param status 状态
     * @return 报名列表
     */
    @Query("SELECT * FROM registrations WHERE status = :status ORDER BY created_at DESC")
    LiveData<List<Registration>> getRegistrationsByStatus(String status);

    /**
     * 获取单个报名
     * @param id 报名 ID
     * @return 报名
     */
    @Query("SELECT * FROM registrations WHERE id = :id")
    LiveData<Registration> getRegistrationById(String id);

    /**
     * 获取单个报名（同步）
     * @param id 报名 ID
     * @return 报名
     */
    @Query("SELECT * FROM registrations WHERE id = :id")
    Registration getRegistrationByIdSync(String id);

    /**
     * 检查是否已报名
     * @param exhibitionId 展会 ID
     * @param visitorId 访客 ID
     * @return 报名数量
     */
    @Query("SELECT COUNT(*) FROM registrations WHERE exhibition_id = :exhibitionId AND visitor_id = :visitorId")
    int getRegistrationCount(String exhibitionId, String visitorId);

    /**
     * 获取报名数量
     * @return 报名数量
     */
    @Query("SELECT COUNT(*) FROM registrations")
    int getRegistrationCount();

    /**
     * 按展会获取报名数量
     * @param exhibitionId 展会 ID
     * @return 报名数量
     */
    @Query("SELECT COUNT(*) FROM registrations WHERE exhibition_id = :exhibitionId")
    int getRegistrationCountByExhibition(String exhibitionId);

    /**
     * 插入报名
     * @param registration 报名
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insert(Registration registration);

    /**
     * 批量插入报名
     * @param registrations 报名列表
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertAll(List<Registration> registrations);

    /**
     * 更新报名
     * @param registration 报名
     */
    @Update
    void update(Registration registration);

    /**
     * 删除报名
     * @param registration 报名
     */
    @Delete
    void delete(Registration registration);

    /**
     * 按 ID 删除报名
     * @param id 报名 ID
     */
    @Query("DELETE FROM registrations WHERE id = :id")
    void deleteById(String id);

    /**
     * 删除所有报名
     */
    @Query("DELETE FROM registrations")
    void deleteAll();
}
