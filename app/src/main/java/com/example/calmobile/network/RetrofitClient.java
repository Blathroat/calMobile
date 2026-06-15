package com.example.calmobile.network;

import android.content.Context;
import android.content.SharedPreferences;

import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.logging.HttpLoggingInterceptor;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Retrofit 客户端单例
 * 管理网络请求配置和认证令牌
 */
public class RetrofitClient {

    private static final String BASE_URL = "http://10.0.2.2:3000/api/v1/";
    private static final String PREF_NAME = "auth_prefs";
    private static final String KEY_ACCESS_TOKEN = "access_token";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";
    
    private static RetrofitClient instance;
    private final ApiService apiService;
    private final SharedPreferences preferences;

    private RetrofitClient(Context context) {
        preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        
        // 创建日志拦截器
        HttpLoggingInterceptor loggingInterceptor = new HttpLoggingInterceptor();
        loggingInterceptor.setLevel(HttpLoggingInterceptor.Level.BODY);
        
        // 创建认证拦截器
        Interceptor authInterceptor = new Interceptor() {
            @Override
            public Response intercept(Chain chain) throws IOException {
                Request original = chain.request();
                String token = getAccessToken();
                
                if (token != null && !token.isEmpty()) {
                    Request.Builder builder = original.newBuilder()
                            .header("Authorization", "Bearer " + token)
                            .header("Content-Type", "application/json")
                            .header("Accept", "application/json");
                    return chain.proceed(builder.build());
                }
                
                return chain.proceed(original);
            }
        };
        
        // 创建 OkHttp 客户端
        OkHttpClient client = new OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
                .addInterceptor(loggingInterceptor)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .build();
        
        // 创建 Retrofit 实例
        Retrofit retrofit = new Retrofit.Builder()
                .baseUrl(BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build();
        
        apiService = retrofit.create(ApiService.class);
    }

    /**
     * 获取单例实例
     * @param context 上下文
     * @return RetrofitClient 实例
     */
    public static synchronized RetrofitClient getInstance(Context context) {
        if (instance == null) {
            instance = new RetrofitClient(context.getApplicationContext());
        }
        return instance;
    }

    /**
     * 获取 API 服务接口
     * @return ApiService 实例
     */
    public ApiService getApiService() {
        return apiService;
    }

    /**
     * 保存认证令牌
     * @param accessToken 访问令牌
     * @param refreshToken 刷新令牌
     */
    public void saveTokens(String accessToken, String refreshToken) {
        preferences.edit()
                .putString(KEY_ACCESS_TOKEN, accessToken)
                .putString(KEY_REFRESH_TOKEN, refreshToken)
                .apply();
    }

    /**
     * 获取访问令牌
     * @return 访问令牌
     */
    public String getAccessToken() {
        return preferences.getString(KEY_ACCESS_TOKEN, null);
    }

    /**
     * 获取刷新令牌
     * @return 刷新令牌
     */
    public String getRefreshToken() {
        return preferences.getString(KEY_REFRESH_TOKEN, null);
    }

    /**
     * 清除认证令牌
     */
    public void clearTokens() {
        preferences.edit()
                .remove(KEY_ACCESS_TOKEN)
                .remove(KEY_REFRESH_TOKEN)
                .apply();
    }

    /**
     * 检查是否已登录
     * @return 是否已登录
     */
    public boolean isLoggedIn() {
        return getAccessToken() != null && !getAccessToken().isEmpty();
    }
}
