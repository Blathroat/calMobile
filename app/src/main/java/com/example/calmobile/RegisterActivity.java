package com.example.calmobile;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Registration activity for new user account creation.
 */
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
                finish(); // go back to LoginActivity
            }
        });
    }

    private void attemptRegister() {
        String username = usernameInput.getText().toString();
        String email = emailInput.getText().toString();
        String password = passwordInput.getText().toString();
        String confirmPassword = passwordConfirmInput.getText().toString();

        // Client-side validation
        if (!password.equals(confirmPassword)) {
            showError("两次输入的密码不一致");
            return;
        }

        String error = AuthManager.getInstance().register(username, password, email);
        if (error != null) {
            showError(error);
            return;
        }

        // Registration success
        errorText.setVisibility(View.GONE);
        Toast.makeText(this, "注册成功，请登录", Toast.LENGTH_SHORT).show();
        finish(); // back to LoginActivity
    }

    private void showError(String message) {
        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }
}
