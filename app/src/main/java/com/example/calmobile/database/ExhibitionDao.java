package com.example.calmobile.database;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Delete;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;

import com.example.calmobile.models.Exhibition;

import java.util.List;

/**
 * 展会数据访问对象
 * 定义展会表的数据库操作
 */
@Dao
public interface ExhibitionDao {

    /**
     * 获取所有展会（按日期排序）
     * @return 展会列表
     */
    @Query("SELECT * FROM exhibitions ORDER BY year, month, day")
    LiveData<List<Exhibition>> getAllExhibitions();

    /**
     * 按月份获取展会
     * @param month 月份
     * @param year 年份
     * @return 展会列表
     */
    @Query("SELECT * FROM exhibitions WHERE month = :month AND year = :year ORDER BY day")
    LiveData<List<Exhibition>> getExhibitionsByMonth(int month, int year);

    /**
     * 按状态获取展会
     * @param status 状态
     * @return 展会列表
     */
    @Query("SELECT * FROM exhibitions WHERE status = :status ORDER BY year, month, day")
    LiveData<List<Exhibition>> getExhibitionsByStatus(String status);

    /**
     * 搜索展会
     * @param query 搜索关键词
     * @return 展会列表
     */
    @Query("SELECT * FROM exhibitions WHERE title LIKE '%' || :query || '%' OR venue LIKE '%' || :query || '%' OR description LIKE '%' || :query || '%' OR category LIKE '%' || :query || '%' ORDER BY year, month, day")
    LiveData<List<Exhibition>> searchExhibitions(String query);

    /**
     * 获取单个展会
     * @param id 展会 ID
     * @return 展会
     */
    @Query("SELECT * FROM exhibitions WHERE id = :id")
    LiveData<Exhibition> getExhibitionById(String id);

    /**
     * 获取单个展会（同步）
     * @param id 展会 ID
     * @return 展会
     */
    @Query("SELECT * FROM exhibitions WHERE id = :id")
    Exhibition getExhibitionByIdSync(String id);

    /**
     * 获取展会数量
     * @return 展会数量
     */
    @Query("SELECT COUNT(*) FROM exhibitions")
    int getExhibitionCount();

    /**
     * 插入展会
     * @param exhibition 展会
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insert(Exhibition exhibition);

    /**
     * 批量插入展会
     * @param exhibitions 展会列表
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertAll(List<Exhibition> exhibitions);

    /**
     * 更新展会
     * @param exhibition 展会
     */
    @Update
    void update(Exhibition exhibition);

    /**
     * 删除展会
     * @param exhibition 展会
     */
    @Delete
    void delete(Exhibition exhibition);

    /**
     * 按 ID 删除展会
     * @param id 展会 ID
     */
    @Query("DELETE FROM exhibitions WHERE id = :id")
    void deleteById(String id);

    /**
     * 删除所有展会
     */
    @Query("DELETE FROM exhibitions")
    void deleteAll();
}
