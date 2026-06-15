package com.example.calmobile;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * API 接口类
 * 封装所有 API 调用
 */
public class ApiService {

    /**
     * 用户登录
     * @param username 用户名
     * @param password 密码
     * @param callback 回调
     */
    public static void login(String username, String password, HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("username", username);
            body.put("password", password);
            HttpClient.post("/auth/login", body, null, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 用户注册
     * @param username 用户名
     * @param password 密码
     * @param email 邮箱
     * @param nickname 昵称
     * @param callback 回调
     */
    public static void register(String username, String password, String email, String nickname, 
                               HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("username", username);
            body.put("password", password);
            body.put("email", email);
            body.put("nickname", nickname);
            HttpClient.post("/auth/register", body, null, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 刷新令牌
     * @param refreshToken 刷新令牌
     * @param callback 回调
     */
    public static void refreshToken(String refreshToken, HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("refreshToken", refreshToken);
            HttpClient.post("/auth/refresh", body, null, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 获取展会列表
     * @param month 月份（可选）
     * @param year 年份（可选）
     * @param status 状态（可选）
     * @param token 认证令牌（可选）
     * @param callback 回调
     */
    public static void getExhibitions(Integer month, Integer year, String status, 
                                     String token, HttpClient.ApiResponseCallback callback) {
        StringBuilder path = new StringBuilder("/exhibitions?");
        if (month != null) {
            path.append("month=").append(month).append("&");
        }
        if (year != null) {
            path.append("year=").append(year).append("&");
        }
        if (status != null && !status.isEmpty()) {
            path.append("status=").append(status).append("&");
        }
        // 移除末尾的 &
        if (path.charAt(path.length() - 1) == '&') {
            path.setLength(path.length() - 1);
        }
        HttpClient.get(path.toString(), token, callback);
    }

    /**
     * 获取单个展会信息
     * @param id 展会 ID
     * @param token 认证令牌（可选）
     * @param callback 回调
     */
    public static void getExhibition(String id, String token, HttpClient.ApiResponseCallback callback) {
        HttpClient.get("/exhibitions/" + id, token, callback);
    }

    /**
     * 创建展会
     * @param exhibition 展会数据
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void createExhibition(JSONObject exhibition, String token, 
                                       HttpClient.ApiResponseCallback callback) {
        HttpClient.post("/exhibitions", exhibition, token, callback);
    }

    /**
     * 更新展会
     * @param id 展会 ID
     * @param exhibition 展会数据
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void updateExhibition(String id, JSONObject exhibition, String token, 
                                       HttpClient.ApiResponseCallback callback) {
        HttpClient.put("/exhibitions/" + id, exhibition, token, callback);
    }

    /**
     * 删除展会
     * @param id 展会 ID
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void deleteExhibition(String id, String token, HttpClient.ApiResponseCallback callback) {
        HttpClient.delete("/exhibitions/" + id, token, callback);
    }

    /**
     * 更新展会状态
     * @param id 展会 ID
     * @param status 新状态
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void updateExhibitionStatus(String id, String status, String token, 
                                             HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            HttpClient.put("/exhibitions/" + id + "/status", body, token, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 获取报名列表
     * @param exhibitionId 展会 ID（可选）
     * @param status 状态（可选）
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void getRegistrations(String exhibitionId, String status, 
                                       String token, HttpClient.ApiResponseCallback callback) {
        StringBuilder path = new StringBuilder("/registrations?");
        if (exhibitionId != null && !exhibitionId.isEmpty()) {
            path.append("exhibitionId=").append(exhibitionId).append("&");
        }
        if (status != null && !status.isEmpty()) {
            path.append("status=").append(status).append("&");
        }
        // 移除末尾的 &
        if (path.charAt(path.length() - 1) == '&') {
            path.setLength(path.length() - 1);
        }
        HttpClient.get(path.toString(), token, callback);
    }

    /**
     * 创建报名
     * @param registration 报名数据
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void createRegistration(JSONObject registration, String token, 
                                        HttpClient.ApiResponseCallback callback) {
        HttpClient.post("/registrations", registration, token, callback);
    }

    /**
     * 更新报名状态
     * @param id 报名 ID
     * @param status 新状态
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void updateRegistrationStatus(String id, String status, String token, 
                                               HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            HttpClient.put("/registrations/" + id, body, token, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 获取用户列表（仅管理员）
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void getUsers(String token, HttpClient.ApiResponseCallback callback) {
        HttpClient.get("/users", token, callback);
    }

    /**
     * 获取单个用户信息
     * @param id 用户 ID
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void getUser(String id, String token, HttpClient.ApiResponseCallback callback) {
        HttpClient.get("/users/" + id, token, callback);
    }

    /**
     * 更新用户信息
     * @param id 用户 ID
     * @param user 用户数据
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void updateUser(String id, JSONObject user, String token, 
                                 HttpClient.ApiResponseCallback callback) {
        HttpClient.put("/users/" + id, user, token, callback);
    }

    /**
     * 更新用户状态（仅管理员）
     * @param id 用户 ID
     * @param status 新状态
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void updateUserStatus(String id, String status, String token, 
                                       HttpClient.ApiResponseCallback callback) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            HttpClient.put("/users/" + id + "/status", body, token, callback);
        } catch (JSONException e) {
            callback.onError("请求数据格式错误");
        }
    }

    /**
     * 删除用户（仅管理员）
     * @param id 用户 ID
     * @param token 认证令牌
     * @param callback 回调
     */
    public static void deleteUser(String id, String token, HttpClient.ApiResponseCallback callback) {
        HttpClient.delete("/users/" + id, token, callback);
    }
}
