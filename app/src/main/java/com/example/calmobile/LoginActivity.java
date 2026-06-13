package com.example.calmobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * Login activity for user authentication.
 * Redirects to MainActivity if the user is already logged in.
 */
public class LoginActivity extends BaseActivity {

    private EditText usernameInput;
    private EditText passwordInput;
    private TextView errorText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // If already logged in, go straight to MainActivity
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
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-check in case user registered and came back
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

        // Login success — go to MainActivity
        errorText.setVisibility(View.GONE);
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
