package com.example.calmobile;

/** 展会报名时由展商配置的收集项。 */
public class RegistrationField {
    public static final String TYPE_TEXT = "文本";
    public static final String TYPE_SINGLE = "单选";
    public static final String TYPE_MULTI = "多选";

    private String title;
    private String type;
    private boolean required;
    private String options;

    public RegistrationField(String title, String type, boolean required, String options) {
        this.title = title == null ? "" : title;
        this.type = type == null ? TYPE_TEXT : type;
        this.required = required;
        this.options = options == null ? "" : options;
    }

    public String getTitle() { return title; }
    public String getType() { return type; }
    public boolean isRequired() { return required; }
    public String getOptions() { return options; }
}
