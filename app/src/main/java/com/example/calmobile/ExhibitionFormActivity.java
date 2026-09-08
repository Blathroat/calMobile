package com.example.calmobile;

import android.app.DatePickerDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.Html;
import android.text.Spanned;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/** 展商创建和编辑展会，包含富文本简介与报名收集配置。 */
public class ExhibitionFormActivity extends BaseActivity {
    public static final String EXTRA_EXHIBITION_ID = "exhibition_id";
    private LinearLayout form, fieldsBox; private EditText title, venue, eventDate, regStart, regEnd, time, description;
    private Spinner category; private RadioGroup status; private String editingId, imageUri = ""; private ImageView preview;
    private final List<LinearLayout> rows = new ArrayList<>();
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); if (!AuthManager.getInstance().canAccessExhibitor()) { finish(); return; }
        setContentView(R.layout.activity_exhibition_form); form = findViewById(R.id.exhibition_form);
        editingId = getIntent().getStringExtra(EXTRA_EXHIBITION_ID); ExhibitorExhibition existing = editingId == null ? null : ExhibitionManager.findById(editingId);
        if (editingId != null && existing == null) { finish(); return; }
        TextView back = findViewById(R.id.exhibition_form_back); applyRippleToBackButton(back); back.setOnClickListener(v -> finish()); build(existing);
    }
    private void build(ExhibitorExhibition ex) {
        form.removeAllViews(); ((TextView)findViewById(R.id.exhibition_form_title)).setText(ex == null ? "新建展会" : "编辑展会");
        title = textField("展会名称", ex == null ? "" : ex.getTitle()); venue = textField("展馆地点", ex == null ? "" : ex.getVenue());
        ExhibitionConfiguration.Data data = ex == null ? null : ExhibitionConfiguration.get(ex.getId());
        String existingDate = data == null ? "" : data.exhibitionDate;
        if (ex != null && (existingDate.isEmpty() || "2026-06-01".equals(existingDate))) {
            existingDate = String.format(java.util.Locale.CHINA, "2026-06-%02d", ex.getDay());
        }
        eventDate = dateField("开展日期", existingDate); regStart = dateField("报名开始日期", data == null ? "" : data.registrationStart); regEnd = dateField("报名截止日期", data == null ? "" : data.registrationEnd);
        time = textField("开展时间", ex == null ? "" : ex.getTime());
        addLabel("展会分类"); category = new Spinner(this); List<String> items = AppSettings.getCategories(this); category.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, items)); if (ex != null) category.setSelection(Math.max(0, items.indexOf(ex.getCategory()))); form.addView(category, fullWidthParams(5));
        addLabel("展会简介"); LinearLayout rich = new LinearLayout(this); rich.setOrientation(LinearLayout.HORIZONTAL);
        Button bold = new Button(this); styleSecondaryButton(bold); bold.setText("加粗"); bold.setOnClickListener(v -> wrap("<b>", "</b>")); rich.addView(bold, new LinearLayout.LayoutParams(0,-2,1));
        Button italic = new Button(this); styleSecondaryButton(italic); italic.setText("斜体"); italic.setOnClickListener(v -> wrap("<i>", "</i>")); rich.addView(italic, new LinearLayout.LayoutParams(0,-2,1)); form.addView(rich, fullWidthParams(2));
        description = new EditText(this); description.setMinLines(4); description.setHint("支持加粗、斜体和图片说明"); description.setText(ex == null ? "" : ex.getDescription()); form.addView(description, fullWidthParams(3));
        Button image = new Button(this); styleSecondaryButton(image); image.setText("插入图片"); image.setOnClickListener(v -> { Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.setType("image/*"); i.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(i, 2201); }); form.addView(image, fullWidthParams(3));
        preview = new ImageView(this); preview.setAdjustViewBounds(true); preview.setMaxHeight(dp(160)); imageUri = data == null ? "" : data.imageUri; showPreview(); form.addView(preview, fullWidthParams(3));
        addLabel("报名信息收集项"); fieldsBox = new LinearLayout(this); fieldsBox.setOrientation(LinearLayout.VERTICAL); form.addView(fieldsBox, fullWidthParams(2));
        if (data != null && !data.fields.isEmpty()) for (RegistrationField f : data.fields) addRow(f); else addRow(null);
        Button add = new Button(this); styleSecondaryButton(add); add.setText("新增收集项"); add.setOnClickListener(v -> addRow(null)); form.addView(add, fullWidthParams(5));
        addLabel("展会状态"); status = new RadioGroup(this); addStatus(ExhibitorExhibition.STATUS_OPEN, ex == null || ExhibitorExhibition.STATUS_OPEN.equals(ex.getStatus())); addStatus(ExhibitorExhibition.STATUS_CLOSED, ex != null && ExhibitorExhibition.STATUS_CLOSED.equals(ex.getStatus())); form.addView(status, fullWidthParams(5));
        Button save = new Button(this); stylePrimaryButton(save); save.setText("保存展会"); save.setOnClickListener(v -> save()); form.addView(save, fullWidthParams(12)); animateListItems(form, 50);
    }
    private EditText textField(String label, String value) { addLabel(label); EditText e = new EditText(this); e.setText(value); form.addView(e, fullWidthParams(4)); return e; }
    private EditText dateField(String label, String value) { EditText e = textField(label, value); e.setFocusable(false); e.setHint("选择日期"); e.setOnClickListener(v -> { Calendar c = Calendar.getInstance(); new DatePickerDialog(this, (x,y,m,d)->e.setText(String.format(java.util.Locale.CHINA,"%04d-%02d-%02d",y,m+1,d)),c.get(1),c.get(2),c.get(5)).show(); }); return e; }
    private void addLabel(String text) { addText(form,text,R.color.text_secondary,13,android.graphics.Typeface.BOLD); }
    private void wrap(String start, String end) { int a=description.getSelectionStart(), b=description.getSelectionEnd(); String s=description.getText().toString(); description.setText(s.substring(0,a)+start+s.substring(a,b)+end+s.substring(b)); description.setSelection(b+start.length()+end.length()); }
    private void addStatus(String value, boolean check) { RadioButton b=new RadioButton(this); b.setText(value); b.setTag(value); b.setId(View.generateViewId()); status.addView(b); if(check)status.check(b.getId()); }
    private void addRow(RegistrationField f) { LinearLayout r=new LinearLayout(this); r.setOrientation(LinearLayout.VERTICAL); EditText t=new EditText(this); t.setHint("条目标题"); if(f!=null)t.setText(f.getTitle()); Spinner type=new Spinner(this); String[] types={"文本","单选","多选"}; type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,types)); if(f!=null)type.setSelection(java.util.Arrays.asList(types).indexOf(f.getType())); CheckBox required=new CheckBox(this); required.setText("必填"); if(f!=null)required.setChecked(f.isRequired()); EditText opts=new EditText(this); opts.setHint("单选、多选请以逗号分隔选项"); if(f!=null)opts.setText(f.getOptions()); Button remove=new Button(this); styleSecondaryButton(remove); remove.setText("删除此项"); remove.setOnClickListener(v->{fieldsBox.removeView(r);rows.remove(r);}); r.addView(t);r.addView(type);r.addView(required);r.addView(opts);r.addView(remove); fieldsBox.addView(r,fullWidthParams(5)); rows.add(r); }
    private void save() { if(title.getText().toString().trim().isEmpty()||venue.getText().toString().trim().isEmpty()||eventDate.getText().toString().trim().isEmpty()){Toast.makeText(this,"请完成展会名称、地点和开展日期",Toast.LENGTH_SHORT).show();return;} int day=1; try{day=Integer.parseInt(eventDate.getText().toString().substring(8));}catch(Exception ignored){} RadioButton b=findViewById(status.getCheckedRadioButtonId()); String st=b==null?ExhibitorExhibition.STATUS_OPEN:b.getTag().toString(); if(editingId==null){ExhibitorExhibition created=ExhibitionManager.add(day,title.getText().toString(),venue.getText().toString(),time.getText().toString(),st,description.getText().toString(),category.getSelectedItem().toString()); editingId=created.getId();}else ExhibitionManager.update(editingId,day,title.getText().toString(),venue.getText().toString(),time.getText().toString(),st,description.getText().toString(),category.getSelectedItem().toString()); List<RegistrationField> fs=new ArrayList<>(); for(LinearLayout r:rows){String n=((EditText)r.getChildAt(0)).getText().toString().trim();if(!n.isEmpty())fs.add(new RegistrationField(n,((Spinner)r.getChildAt(1)).getSelectedItem().toString(),((CheckBox)r.getChildAt(2)).isChecked(),((EditText)r.getChildAt(3)).getText().toString()));} ExhibitionConfiguration.save(editingId,eventDate.getText().toString(),regStart.getText().toString(),regEnd.getText().toString(),imageUri,fs); Toast.makeText(this,"展会已保存",Toast.LENGTH_SHORT).show();finish(); }
    @Override protected void onActivityResult(int r,int c,Intent d){super.onActivityResult(r,c,d);if(r==2201&&c==RESULT_OK&&d!=null&&d.getData()!=null){imageUri=d.getData().toString();try{getContentResolver().takePersistableUriPermission(d.getData(),d.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(SecurityException ignored){}showPreview();}}
    private void showPreview(){if(preview!=null&&!imageUri.isEmpty()){preview.setImageURI(android.net.Uri.parse(imageUri));preview.setVisibility(View.VISIBLE);}else if(preview!=null)preview.setVisibility(View.GONE);}
}
