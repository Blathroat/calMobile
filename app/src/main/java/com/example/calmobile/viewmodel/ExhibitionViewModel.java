package com.example.calmobile.viewmodel;

import android.app.Application;

import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.Transformations;

import com.example.calmobile.models.Exhibition;
import com.example.calmobile.repository.ExhibitionRepository;

import java.util.List;

/**
 * 展会视图模型
 * 管理展会相关的 UI 状态和业务逻辑
 */
public class ExhibitionViewModel extends AndroidViewModel {

    private final ExhibitionRepository repository;
    
    // 展会列表
    private final LiveData<List<Exhibition>> allExhibitions;
    
    // 当前月份和年份
    private final MutableLiveData<Integer> currentMonth = new MutableLiveData<>();
    private final MutableLiveData<Integer> currentYear = new MutableLiveData<>();
    
    // 按月份筛选的展会
    private final LiveData<List<Exhibition>> exhibitionsByMonth;
    
    // 搜索关键词
    private final MutableLiveData<String> searchQuery = new MutableLiveData<>();
    
    // 搜索结果
    private final LiveData<List<Exhibition>> searchResults;
    
    // 加载状态
    private final MutableLiveData<Boolean> isLoading = new MutableLiveData<>(false);
    
    // 错误消息
    private final MutableLiveData<String> errorMessage = new MutableLiveData<>();
    
    // 操作结果
    private final MutableLiveData<Boolean> operationResult = new MutableLiveData<>();

    public ExhibitionViewModel(@NonNull Application application) {
        super(application);
        repository = new ExhibitionRepository(application);
        
        // 初始化展会列表
        allExhibitions = repository.getAllExhibitions();
        
        // 初始化按月份筛选的展会
        exhibitionsByMonth = Transformations.switchMap(
                currentMonth,
                month -> {
                    Integer year = currentYear.getValue();
                    if (month != null && year != null) {
                        return repository.getExhibitionsByMonth(month, year);
                    }
                    return repository.getAllExhibitions();
                }
        );
        
        // 初始化搜索结果
        searchResults = Transformations.switchMap(
                searchQuery,
                query -> {
                    if (query != null && !query.isEmpty()) {
                        return repository.searchExhibitions(query);
                    }
                    return repository.getAllExhibitions();
                }
        );
    }

    // ==================== Getters ====================

    /**
     * 获取所有展会
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> getAllExhibitions() {
        return allExhibitions;
    }

    /**
     * 获取按月份筛选的展会
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> getExhibitionsByMonth() {
        return exhibitionsByMonth;
    }

    /**
     * 获取搜索结果
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> getSearchResults() {
        return searchResults;
    }

    /**
     * 获取加载状态
     * @return 是否加载中
     */
    public LiveData<Boolean> getIsLoading() {
        return isLoading;
    }

    /**
     * 获取错误消息
     * @return 错误消息
     */
    public LiveData<String> getErrorMessage() {
        return errorMessage;
    }

    /**
     * 获取操作结果
     * @return 操作是否成功
     */
    public LiveData<Boolean> getOperationResult() {
        return operationResult;
    }

    /**
     * 获取当前月份
     * @return 当前月份
     */
    public LiveData<Integer> getCurrentMonth() {
        return currentMonth;
    }

    /**
     * 获取当前年份
     * @return 当前年份
     */
    public LiveData<Integer> getCurrentYear() {
        return currentYear;
    }

    // ==================== 操作方法 ====================

    /**
     * 设置当前月份和年份
     * @param month 月份
     * @param year 年份
     */
    public void setCurrentMonth(int month, int year) {
        currentMonth.setValue(month);
        currentYear.setValue(year);
    }

    /**
     * 切换到上一个月
     */
    public void previousMonth() {
        Integer month = currentMonth.getValue();
        Integer year = currentYear.getValue();
        
        if (month != null && year != null) {
            month--;
            if (month < 1) {
                month = 12;
                year--;
            }
            currentMonth.setValue(month);
            currentYear.setValue(year);
        }
    }

    /**
     * 切换到下一个月
     */
    public void nextMonth() {
        Integer month = currentMonth.getValue();
        Integer year = currentYear.getValue();
        
        if (month != null && year != null) {
            month++;
            if (month > 12) {
                month = 1;
                year++;
            }
            currentMonth.setValue(month);
            currentYear.setValue(year);
        }
    }

    /**
     * 搜索展会
     * @param query 搜索关键词
     */
    public void searchExhibitions(String query) {
        searchQuery.setValue(query);
    }

    /**
     * 刷新展会列表
     */
    public void refreshExhibitions() {
        isLoading.setValue(true);
        errorMessage.setValue(null);
        
        Integer month = currentMonth.getValue();
        Integer year = currentYear.getValue();
        
        repository.refreshExhibitions(month, year, null)
                .observeForever(success -> {
                    isLoading.setValue(false);
                    if (!success) {
                        errorMessage.setValue("刷新展会列表失败");
                    }
                });
    }

    /**
     * 创建展会
     * @param exhibition 展会数据
     */
    public void createExhibition(Exhibition exhibition) {
        isLoading.setValue(true);
        errorMessage.setValue(null);
        
        repository.createExhibition(exhibition)
                .observeForever(success -> {
                    isLoading.setValue(false);
                    operationResult.setValue(success);
                    if (!success) {
                        errorMessage.setValue("创建展会失败");
                    }
                });
    }

    /**
     * 更新展会
     * @param id 展会 ID
     * @param exhibition 展会数据
     */
    public void updateExhibition(String id, Exhibition exhibition) {
        isLoading.setValue(true);
        errorMessage.setValue(null);
        
        repository.updateExhibition(id, exhibition)
                .observeForever(success -> {
                    isLoading.setValue(false);
                    operationResult.setValue(success);
                    if (!success) {
                        errorMessage.setValue("更新展会失败");
                    }
                });
    }

    /**
     * 删除展会
     * @param id 展会 ID
     */
    public void deleteExhibition(String id) {
        isLoading.setValue(true);
        errorMessage.setValue(null);
        
        repository.deleteExhibition(id)
                .observeForever(success -> {
                    isLoading.setValue(false);
                    operationResult.setValue(success);
                    if (!success) {
                        errorMessage.setValue("删除展会失败");
                    }
                });
    }

    /**
     * 更新展会状态
     * @param id 展会 ID
     * @param status 新状态
     */
    public void updateExhibitionStatus(String id, String status) {
        isLoading.setValue(true);
        errorMessage.setValue(null);
        
        repository.updateExhibitionStatus(id, status)
                .observeForever(success -> {
                    isLoading.setValue(false);
                    operationResult.setValue(success);
                    if (!success) {
                        errorMessage.setValue("更新展会状态失败");
                    }
                });
    }

    /**
     * 清除错误消息
     */
    public void clearError() {
        errorMessage.setValue(null);
    }

    /**
     * 清除操作结果
     */
    public void clearOperationResult() {
        operationResult.setValue(null);
    }
}
