package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/**
 * 展会扩展信息的 Patch 写入语义。
 *
 * 保存展会时分几段写入（日期、简介格式、二维码开关、收集项），
 * 这里守住的核心不变量是「只写 Patch 里设过的字段」：任何一段都不许把其它段
 * 覆盖回默认值，收集项也不许因为传回自己的列表而被清空。
 */
public class ExhibitionConfigurationTest {

    @Test
    public void 未配置过的展会返回默认值且不写入存储() {
        ExhibitionConfiguration.Data first = ExhibitionConfiguration.get("exh-cfg-missing");
        first.imageUri = "被改坏的临时对象";

        // 读取不应把临时对象存进存储，下一次读到的仍是默认值。
        assertEquals("", ExhibitionConfiguration.get("exh-cfg-missing").imageUri);
    }

    @Test
    public void 分段写入不会互相覆盖() {
        String id = "exh-cfg-a";
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch()
                .dates("2026-07-09", "2026-06-01", "2026-06-30")
                .image("/media/a.png")
                .descriptionFormat("html"));
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch().registrationQr(true));

        ExhibitionConfiguration.Data data = ExhibitionConfiguration.get(id);
        assertEquals("2026-07-09", data.exhibitionDate);
        assertEquals("2026-06-01", data.registrationStart);
        assertEquals("2026-06-30", data.registrationEnd);
        assertEquals("/media/a.png", data.imageUri);
        assertEquals("html", data.descriptionFormat);
        assertTrue(data.registrationQrEnabled);
    }

    @Test
    public void 只写收集项时其它字段保持原值() {
        String id = "exh-cfg-b";
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch().image("/media/b.png"));
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch()
                .fields(Arrays.asList(new RegistrationField("兴趣方向", RegistrationField.TYPE_TEXT, true, ""))));

        ExhibitionConfiguration.Data data = ExhibitionConfiguration.get(id);
        assertEquals("/media/b.png", data.imageUri);
        assertEquals(1, data.fields.size());
        assertEquals("兴趣方向", data.fields.get(0).getTitle());
    }

    @Test
    public void 把读到的收集项原样写回不会清空自己() {
        String id = "exh-cfg-c";
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch()
                .fields(Arrays.asList(new RegistrationField("公司", RegistrationField.TYPE_TEXT, false, ""))));

        // 调用方（ExhibitionActions）会把 get() 拿到的列表再传回 Patch，
        // 旧实现先 clear 再从同一个列表 addAll，会把收集项清空。
        ExhibitionConfiguration.Data current = ExhibitionConfiguration.get(id);
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch().fields(current.fields));

        assertEquals(1, ExhibitionConfiguration.get(id).fields.size());
    }

    @Test
    public void 写入的列表与调用方的列表不共享引用() {
        String id = "exh-cfg-d";
        List<RegistrationField> source = new java.util.ArrayList<>();
        source.add(new RegistrationField("姓名", RegistrationField.TYPE_TEXT, true, ""));
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch().fields(source));
        source.clear();

        assertEquals(1, ExhibitionConfiguration.get(id).fields.size());
        assertNotSame(source, ExhibitionConfiguration.get(id).fields);
    }

    @Test
    public void 简介格式只接受_html_与_md() {
        String id = "exh-cfg-e";
        ExhibitionConfiguration.save(id, new ExhibitionConfiguration.Patch().descriptionFormat("markdown"));
        assertEquals("md", ExhibitionConfiguration.get(id).descriptionFormat);
    }

    @Test
    public void 展会日期缺省时回落到展会自身的日期() {
        assertEquals("2026-06-08", ExhibitionConfiguration.displayDate("exh-cfg-f", 8));
        ExhibitionConfiguration.save("exh-cfg-f", new ExhibitionConfiguration.Patch()
                .dates("2026-08-16", "2026-07-01", "2026-07-31"));
        assertEquals("2026-08-16", ExhibitionConfiguration.displayDate("exh-cfg-f", 8));
    }
}
