package com.example.calmobile;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import jp.wasabeef.richeditor.RichEditor;

/** 使用开源 RichEditor 编辑展会简介和插图。 */
public class RichDescriptionEditorActivity extends BaseActivity {
    public static final String EXTRA_HTML = "description_html";
    public static final String EXTRA_IMAGE_URI = "description_image_uri";
    private static final int REQUEST_IMAGE = 4301;
    private RichEditor editor;
    private String imageUri = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_rich_description_editor);
        editor = findViewById(R.id.rich_editor);
        editor.setPlaceholder("介绍展会亮点、展品范围和适合人群…");
        String initialHtml = getIntent().getStringExtra(EXTRA_HTML);
        editor.setHtml(initialHtml == null ? "" : initialHtml);
        imageUri = getIntent().getStringExtra(EXTRA_IMAGE_URI);
        if (imageUri == null) imageUri = "";

        TextView back = findViewById(R.id.rich_editor_back);
        applyRippleToBackButton(back);
        back.setOnClickListener(v -> finish());
        Button save = findViewById(R.id.rich_editor_save);
        stylePrimaryButton(save);
        save.setOnClickListener(v -> finishWithResult());
        buildToolbar();
    }

    private void buildToolbar() {
        LinearLayout toolbar = findViewById(R.id.rich_editor_toolbar);
        addTool(toolbar, "加粗", v -> editor.setBold());
        addTool(toolbar, "斜体", v -> editor.setItalic());
        addTool(toolbar, "标题", v -> editor.setHeading(2));
        addTool(toolbar, "项目", v -> editor.setBullets());
        addTool(toolbar, "编号", v -> editor.setNumbers());
        addTool(toolbar, "链接", v -> editor.insertLink("https://", "链接"));
        addTool(toolbar, "图片", v -> chooseImage());
    }

    private void addTool(LinearLayout toolbar, String label, View.OnClickListener listener) {
        Button button = new Button(this);
        styleSecondaryButton(button);
        button.setText(label);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, dp(6), 0);
        toolbar.addView(button, params);
    }

    private void chooseImage() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(intent, REQUEST_IMAGE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_IMAGE || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        imageUri = data.getData().toString();
        try {
            getContentResolver().takePersistableUriPermission(data.getData(),
                    data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        } catch (SecurityException ignored) {
            // 部分文档提供方不支持持久化授权，当前会话仍可正常预览。
        }
        editor.insertImage(imageUri, "展会图片");
    }

    private void finishWithResult() {
        Intent result = new Intent();
        result.putExtra(EXTRA_HTML, editor.getHtml());
        result.putExtra(EXTRA_IMAGE_URI, imageUri);
        setResult(RESULT_OK, result);
        finish();
    }
}
