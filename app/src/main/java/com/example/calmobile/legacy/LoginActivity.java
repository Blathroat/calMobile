package com.example.calmobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/** 处理用户登录；已登录用户直接进入首页。 */
public class LoginActivity extends BaseActivity {

    private EditText usernameInput;
    private EditText passwordInput;
    private TextView errorText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 已登录时直接进入首页
        if (AuthManager.getInstance().isLoggedIn()) {
            startActivity(new Intent(this, MainActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_login);

        usernameInput = findViewById(R.id.login_username);
        passwordInput = findViewById(R.id.login_password);
        errorText = findViewById(R.id.login_error);

        Button loginBtn = findViewById(R.id.login_btn);
        loginBtn.setAllCaps(false);
        loginBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                attemptLogin();
            }
        });

        Button registerBtn = findViewById(R.id.go_to_register_btn);
        registerBtn.setAllCaps(false);
        registerBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(LoginActivity.this, RegisterActivity.class));
            }
        });

        Button guestBtn = findViewById(R.id.guest_entry_btn);
        guestBtn.setAllCaps(false);
        guestBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                continueAsGuest();
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 注册完成返回时再次检查登录状态
        if (AuthManager.getInstance().isLoggedIn()) {
            startActivity(new Intent(this, MainActivity.class));
            finish();
        }
    }

    private void attemptLogin() {
        String username = usernameInput.getText().toString();
        String password = passwordInput.getText().toString();

        String error = AuthManager.getInstance().login(username, password);
        if (error != null) {
            errorText.setText(error);
            errorText.setVisibility(View.VISIBLE);
            return;
        }

        // 登录成功后进入首页
        errorText.setVisibility(View.GONE);
        openHome();
    }

    private void continueAsGuest() {
        AuthManager.getInstance().enterAsGuest();
        errorText.setVisibility(View.GONE);
        openHome();
    }

    private void openHome() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
