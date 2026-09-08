package com.example.calmobile;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/** 创建本地演示账号。 */
public class RegisterActivity extends BaseActivity {

    private EditText usernameInput;
    private EditText emailInput;
    private EditText passwordInput;
    private EditText passwordConfirmInput;
    private TextView errorText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);

        usernameInput = findViewById(R.id.register_username);
        emailInput = findViewById(R.id.register_email);
        passwordInput = findViewById(R.id.register_password);
        passwordConfirmInput = findViewById(R.id.register_password_confirm);
        errorText = findViewById(R.id.register_error);

        Button registerBtn = findViewById(R.id.register_btn);
        registerBtn.setAllCaps(false);
        registerBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                attemptRegister();
            }
        });

        Button backToLoginBtn = findViewById(R.id.go_to_login_btn);
        backToLoginBtn.setAllCaps(false);
        backToLoginBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                finish(); // 返回登录页
            }
        });
    }

    private void attemptRegister() {
        String username = usernameInput.getText().toString();
        String email = emailInput.getText().toString();
        String password = passwordInput.getText().toString();
        String confirmPassword = passwordConfirmInput.getText().toString();

        // 客户端输入校验
        if (!password.equals(confirmPassword)) {
            showError("两次输入的密码不一致");
            return;
        }

        String error = AuthManager.getInstance().register(username, password, email);
        if (error != null) {
            showError(error);
            return;
        }

        // 注册成功
        errorText.setVisibility(View.GONE);
        Toast.makeText(this, "注册成功，请登录", Toast.LENGTH_SHORT).show();
        finish(); // 返回登录页
    }

    private void showError(String message) {
        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }
}
