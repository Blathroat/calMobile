package com.example.calmobile.network;

import com.example.calmobile.models.ApiResponse;
import com.example.calmobile.models.Exhibition;
import com.example.calmobile.models.LoginRequest;
import com.example.calmobile.models.LoginResponse;
import com.example.calmobile.models.RegisterRequest;
import com.example.calmobile.models.Registration;
import com.example.calmobile.models.StatusUpdate;
import com.example.calmobile.models.User;

import java.util.List;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.PUT;
import retrofit2.http.Path;
import retrofit2.http.Query;

/**
 * Retrofit API 服务接口
 * 定义所有 API 端点
 */
public interface ApiService {

    // ==================== 认证接口 ====================

    /**
     * 用户登录
     * @param request 登录请求
     * @return 登录响应
     */
    @POST("auth/login")
    Call<ApiResponse<LoginResponse>> login(@Body LoginRequest request);

    /**
     * 用户注册
     * @param request 注册请求
     * @return 登录响应
     */
    @POST("auth/register")
    Call<ApiResponse<LoginResponse>> register(@Body RegisterRequest request);

    /**
     * 刷新令牌
     * @param refreshToken 刷新令牌
     * @return 新的令牌
     */
    @POST("auth/refresh")
    Call<ApiResponse<LoginResponse>> refreshToken(@Body String refreshToken);

    /**
     * 用户登出
     * @return 响应
     */
    @POST("auth/logout")
    Call<ApiResponse<Void>> logout();

    // ==================== 用户接口 ====================

    /**
     * 获取用户列表（仅管理员）
     * @return 用户列表
     */
    @GET("users")
    Call<ApiResponse<List<User>>> getUsers();

    /**
     * 获取单个用户信息
     * @param id 用户 ID
     * @return 用户信息
     */
    @GET("users/{id}")
    Call<ApiResponse<User>> getUser(@Path("id") String id);

    /**
     * 更新用户信息
     * @param id 用户 ID
     * @param user 用户数据
     * @return 更新后的用户信息
     */
    @PUT("users/{id}")
    Call<ApiResponse<User>> updateUser(@Path("id") String id, @Body User user);

    /**
     * 删除用户（仅管理员）
     * @param id 用户 ID
     * @return 响应
     */
    @DELETE("users/{id}")
    Call<ApiResponse<Void>> deleteUser(@Path("id") String id);

    /**
     * 更新用户状态（仅管理员）
     * @param id 用户 ID
     * @param status 状态更新
     * @return 更新后的用户信息
     */
    @PUT("users/{id}/status")
    Call<ApiResponse<User>> updateUserStatus(@Path("id") String id, @Body StatusUpdate status);

    // ==================== 展会接口 ====================

    /**
     * 获取展会列表
     * @param month 月份（可选）
     * @param year 年份（可选）
     * @param status 状态（可选）
     * @param category 分类（可选）
     * @param search 搜索关键词（可选）
     * @return 展会列表
     */
    @GET("exhibitions")
    Call<ApiResponse<List<Exhibition>>> getExhibitions(
            @Query("month") Integer month,
            @Query("year") Integer year,
            @Query("status") String status,
            @Query("category") String category,
            @Query("search") String search
    );

    /**
     * 搜索展会
     * @param query 搜索关键词
     * @return 展会列表
     */
    @GET("exhibitions/search")
    Call<ApiResponse<List<Exhibition>>> searchExhibitions(@Query("q") String query);

    /**
     * 获取单个展会信息
     * @param id 展会 ID
     * @return 展会信息
     */
    @GET("exhibitions/{id}")
    Call<ApiResponse<Exhibition>> getExhibition(@Path("id") String id);

    /**
     * 创建展会
     * @param exhibition 展会数据
     * @return 创建的展会信息
     */
    @POST("exhibitions")
    Call<ApiResponse<Exhibition>> createExhibition(@Body Exhibition exhibition);

    /**
     * 更新展会
     * @param id 展会 ID
     * @param exhibition 展会数据
     * @return 更新后的展会信息
     */
    @PUT("exhibitions/{id}")
    Call<ApiResponse<Exhibition>> updateExhibition(@Path("id") String id, @Body Exhibition exhibition);

    /**
     * 删除展会
     * @param id 展会 ID
     * @return 响应
     */
    @DELETE("exhibitions/{id}")
    Call<ApiResponse<Void>> deleteExhibition(@Path("id") String id);

    /**
     * 更新展会状态
     * @param id 展会 ID
     * @param status 状态更新
     * @return 更新后的展会信息
     */
    @PUT("exhibitions/{id}/status")
    Call<ApiResponse<Exhibition>> updateExhibitionStatus(@Path("id") String id, @Body StatusUpdate status);

    // ==================== 报名接口 ====================

    /**
     * 获取报名列表
     * @param exhibitionId 展会 ID（可选）
     * @param status 状态（可选）
     * @return 报名列表
     */
    @GET("registrations")
    Call<ApiResponse<List<Registration>>> getRegistrations(
            @Query("exhibitionId") String exhibitionId,
            @Query("status") String status
    );

    /**
     * 获取单个报名信息
     * @param id 报名 ID
     * @return 报名信息
     */
    @GET("registrations/{id}")
    Call<ApiResponse<Registration>> getRegistration(@Path("id") String id);

    /**
     * 创建报名
     * @param registration 报名数据
     * @return 创建的报名信息
     */
    @POST("registrations")
    Call<ApiResponse<Registration>> createRegistration(@Body Registration registration);

    /**
     * 更新报名状态
     * @param id 报名 ID
     * @param status 状态更新
     * @return 更新后的报名信息
     */
    @PUT("registrations/{id}")
    Call<ApiResponse<Registration>> updateRegistrationStatus(@Path("id") String id, @Body StatusUpdate status);

    /**
     * 删除报名
     * @param id 报名 ID
     * @return 响应
     */
    @DELETE("registrations/{id}")
    Call<ApiResponse<Void>> deleteRegistration(@Path("id") String id);
}
