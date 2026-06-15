package com.example.calmobile.repository;

import android.app.Application;
import android.util.Log;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.example.calmobile.database.AppDatabase;
import com.example.calmobile.database.ExhibitionDao;
import com.example.calmobile.models.ApiResponse;
import com.example.calmobile.models.Exhibition;
import com.example.calmobile.models.StatusUpdate;
import com.example.calmobile.network.ApiService;
import com.example.calmobile.network.RetrofitClient;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * 展会仓库类
 * 管理展会数据的本地和远程数据源
 */
public class ExhibitionRepository {

    private static final String TAG = "ExhibitionRepository";
    
    private final ExhibitionDao exhibitionDao;
    private final ApiService apiService;
    private final ExecutorService executorService;

    public ExhibitionRepository(Application application) {
        AppDatabase database = AppDatabase.getInstance(application);
        exhibitionDao = database.exhibitionDao();
        apiService = RetrofitClient.getInstance(application).getApiService();
        executorService = Executors.newFixedThreadPool(4);
    }

    /**
     * 获取所有展会（本地缓存）
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> getAllExhibitions() {
        return exhibitionDao.getAllExhibitions();
    }

    /**
     * 按月份获取展会（本地缓存）
     * @param month 月份
     * @param year 年份
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> getExhibitionsByMonth(int month, int year) {
        return exhibitionDao.getExhibitionsByMonth(month, year);
    }

    /**
     * 搜索展会（本地缓存）
     * @param query 搜索关键词
     * @return 展会列表
     */
    public LiveData<List<Exhibition>> searchExhibitions(String query) {
        return exhibitionDao.searchExhibitions(query);
    }

    /**
     * 获取单个展会（本地缓存）
     * @param id 展会 ID
     * @return 展会
     */
    public LiveData<Exhibition> getExhibitionById(String id) {
        return exhibitionDao.getExhibitionById(id);
    }

    /**
     * 从服务器刷新展会列表
     * @param month 月份（可选）
     * @param year 年份（可选）
     * @param status 状态（可选）
     * @return 操作结果
     */
    public LiveData<Boolean> refreshExhibitions(Integer month, Integer year, String status) {
        MutableLiveData<Boolean> result = new MutableLiveData<>();
        
        apiService.getExhibitions(month, year, status, null, null)
                .enqueue(new Callback<ApiResponse<List<Exhibition>>>() {
                    @Override
                    public void onResponse(Call<ApiResponse<List<Exhibition>>> call, 
                                         Response<ApiResponse<List<Exhibition>>> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                            List<Exhibition> exhibitions = response.body().getData();
                            executorService.execute(() -> {
                                exhibitionDao.deleteAll();
                                exhibitionDao.insertAll(exhibitions);
                            });
                            result.postValue(true);
                        } else {
                            Log.e(TAG, "刷新展会失败: " + (response.body() != null ? response.body().getErrorMessage() : "未知错误"));
                            result.postValue(false);
                        }
                    }

                    @Override
                    public void onFailure(Call<ApiResponse<List<Exhibition>>> call, Throwable t) {
                        Log.e(TAG, "刷新展会网络错误", t);
                        result.postValue(false);
                    }
                });
        
        return result;
    }

    /**
     * 创建展会
     * @param exhibition 展会数据
     * @return 操作结果
     */
    public LiveData<Boolean> createExhibition(Exhibition exhibition) {
        MutableLiveData<Boolean> result = new MutableLiveData<>();
        
        apiService.createExhibition(exhibition)
                .enqueue(new Callback<ApiResponse<Exhibition>>() {
                    @Override
                    public void onResponse(Call<ApiResponse<Exhibition>> call, 
                                         Response<ApiResponse<Exhibition>> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                            Exhibition newExhibition = response.body().getData();
                            executorService.execute(() -> exhibitionDao.insert(newExhibition));
                            result.postValue(true);
                        } else {
                            Log.e(TAG, "创建展会失败: " + (response.body() != null ? response.body().getErrorMessage() : "未知错误"));
                            result.postValue(false);
                        }
                    }

                    @Override
                    public void onFailure(Call<ApiResponse<Exhibition>> call, Throwable t) {
                        Log.e(TAG, "创建展会网络错误", t);
                        result.postValue(false);
                    }
                });
        
        return result;
    }

    /**
     * 更新展会
     * @param id 展会 ID
     * @param exhibition 展会数据
     * @return 操作结果
     */
    public LiveData<Boolean> updateExhibition(String id, Exhibition exhibition) {
        MutableLiveData<Boolean> result = new MutableLiveData<>();
        
        apiService.updateExhibition(id, exhibition)
                .enqueue(new Callback<ApiResponse<Exhibition>>() {
                    @Override
                    public void onResponse(Call<ApiResponse<Exhibition>> call, 
                                         Response<ApiResponse<Exhibition>> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                            Exhibition updatedExhibition = response.body().getData();
                            executorService.execute(() -> exhibitionDao.update(updatedExhibition));
                            result.postValue(true);
                        } else {
                            Log.e(TAG, "更新展会失败: " + (response.body() != null ? response.body().getErrorMessage() : "未知错误"));
                            result.postValue(false);
                        }
                    }

                    @Override
                    public void onFailure(Call<ApiResponse<Exhibition>> call, Throwable t) {
                        Log.e(TAG, "更新展会网络错误", t);
                        result.postValue(false);
                    }
                });
        
        return result;
    }

    /**
     * 删除展会
     * @param id 展会 ID
     * @return 操作结果
     */
    public LiveData<Boolean> deleteExhibition(String id) {
        MutableLiveData<Boolean> result = new MutableLiveData<>();
        
        apiService.deleteExhibition(id)
                .enqueue(new Callback<ApiResponse<Void>>() {
                    @Override
                    public void onResponse(Call<ApiResponse<Void>> call, 
                                         Response<ApiResponse<Void>> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                            executorService.execute(() -> exhibitionDao.deleteById(id));
                            result.postValue(true);
                        } else {
                            Log.e(TAG, "删除展会失败: " + (response.body() != null ? response.body().getErrorMessage() : "未知错误"));
                            result.postValue(false);
                        }
                    }

                    @Override
                    public void onFailure(Call<ApiResponse<Void>> call, Throwable t) {
                        Log.e(TAG, "删除展会网络错误", t);
                        result.postValue(false);
                    }
                });
        
        return result;
    }

    /**
     * 更新展会状态
     * @param id 展会 ID
     * @param status 新状态
     * @return 操作结果
     */
    public LiveData<Boolean> updateExhibitionStatus(String id, String status) {
        MutableLiveData<Boolean> result = new MutableLiveData<>();
        
        StatusUpdate statusUpdate = new StatusUpdate(status);
        apiService.updateExhibitionStatus(id, statusUpdate)
                .enqueue(new Callback<ApiResponse<Exhibition>>() {
                    @Override
                    public void onResponse(Call<ApiResponse<Exhibition>> call, 
                                         Response<ApiResponse<Exhibition>> response) {
                        if (response.isSuccessful() && response.body() != null && response.body().isSuccess()) {
                            Exhibition updatedExhibition = response.body().getData();
                            executorService.execute(() -> exhibitionDao.update(updatedExhibition));
                            result.postValue(true);
                        } else {
                            Log.e(TAG, "更新展会状态失败: " + (response.body() != null ? response.body().getErrorMessage() : "未知错误"));
                            result.postValue(false);
                        }
                    }

                    @Override
                    public void onFailure(Call<ApiResponse<Exhibition>> call, Throwable t) {
                        Log.e(TAG, "更新展会状态网络错误", t);
                        result.postValue(false);
                    }
                });
        
        return result;
    }
}
