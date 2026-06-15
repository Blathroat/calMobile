package com.example.calmobile;

import android.os.AsyncTask;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * HTTP 客户端工具类
 * 使用原生 HttpURLConnection 实现 API 调用
 */
public class HttpClient {

    private static final String TAG = "HttpClient";
    private static final int CONNECT_TIMEOUT = 10000; // 10秒
    private static final int READ_TIMEOUT = 10000; // 10秒

    /**
     * API 响应回调接口
     */
    public interface ApiResponseCallback {
        void onSuccess(JSONObject response);
        void onError(String error);
    }

    /**
     * 获取 API 基础 URL
     * @return API 基础 URL
     */
    private static String getBaseUrl() {
        // 开发环境使用本地服务器
        return "http://10.0.2.2:3000/api/v1";
    }

    /**
     * 发送 GET 请求
     * @param path API 路径
     * @param token 认证令牌（可选）
     * @param callback 响应回调
     */
    public static void get(String path, String token, ApiResponseCallback callback) {
        new HttpRequestTask(callback).execute("GET", getBaseUrl() + path, token, null);
    }

    /**
     * 发送 POST 请求
     * @param path API 路径
     * @param body 请求体
     * @param token 认证令牌（可选）
     * @param callback 响应回调
     */
    public static void post(String path, JSONObject body, String token, ApiResponseCallback callback) {
        new HttpRequestTask(callback).execute("POST", getBaseUrl() + path, token, body.toString());
    }

    /**
     * 发送 PUT 请求
     * @param path API 路径
     * @param body 请求体
     * @param token 认证令牌（可选）
     * @param callback 响应回调
     */
    public static void put(String path, JSONObject body, String token, ApiResponseCallback callback) {
        new HttpRequestTask(callback).execute("PUT", getBaseUrl() + path, token, body.toString());
    }

    /**
     * 发送 DELETE 请求
     * @param path API 路径
     * @param token 认证令牌（可选）
     * @param callback 响应回调
     */
    public static void delete(String path, String token, ApiResponseCallback callback) {
        new HttpRequestTask(callback).execute("DELETE", getBaseUrl() + path, token, null);
    }

    /**
     * 异步 HTTP 请求任务
     */
    private static class HttpRequestTask extends AsyncTask<String, Void, String> {

        private final ApiResponseCallback callback;
        private String error = null;

        public HttpRequestTask(ApiResponseCallback callback) {
            this.callback = callback;
        }

        @Override
        protected String doInBackground(String... params) {
            String method = params[0];
            String urlStr = params[1];
            String token = params[2];
            String body = params[3];

            HttpURLConnection connection = null;
            try {
                URL url = new URL(urlStr);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(CONNECT_TIMEOUT);
                connection.setReadTimeout(READ_TIMEOUT);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Accept", "application/json");

                // 添加认证令牌
                if (token != null && !token.isEmpty()) {
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                }

                // 发送请求体
                if (body != null && !body.isEmpty()) {
                    connection.setDoOutput(true);
                    try (OutputStream os = connection.getOutputStream()) {
                        byte[] input = body.getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }
                }

                int responseCode = connection.getResponseCode();
                BufferedReader reader;
                if (responseCode >= 200 && responseCode < 300) {
                    reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                } else {
                    reader = new BufferedReader(new InputStreamReader(connection.getErrorStream(), StandardCharsets.UTF_8));
                }

                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                if (responseCode >= 200 && responseCode < 300) {
                    return response.toString();
                } else {
                    error = "HTTP " + responseCode + ": " + response.toString();
                    return null;
                }

            } catch (IOException e) {
                Log.e(TAG, "网络请求错误", e);
                error = "网络连接失败: " + e.getMessage();
                return null;
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }

        @Override
        protected void onPostExecute(String result) {
            if (result != null) {
                try {
                    JSONObject jsonResponse = new JSONObject(result);
                    callback.onSuccess(jsonResponse);
                } catch (JSONException e) {
                    Log.e(TAG, "JSON 解析错误", e);
                    callback.onError("响应数据格式错误");
                }
            } else {
                callback.onError(error != null ? error : "未知错误");
            }
        }
    }
}
