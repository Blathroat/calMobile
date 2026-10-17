package com.example.calmobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Map;

import org.junit.Test;

/** 设备媒体要能被页面 fetch。缺 CORS 时封面和简介上传会报 Failed to fetch。 */
public class MediaCorsTest {

    @Test
    public void echoesThePageOrigin() {
        Map<String, String> headers = MediaCors.headers("https://example.com");
        assertEquals("https://example.com", headers.get("Access-Control-Allow-Origin"));
        assertTrue(headers.get("Access-Control-Allow-Methods").contains("GET"));
        assertEquals("nosniff", headers.get("X-Content-Type-Options"));
    }

    @Test
    public void fallsBackToAnyOriginWhenThePageOriginIsMissing() {
        assertEquals("*", MediaCors.headers(null).get("Access-Control-Allow-Origin"));
        assertEquals("*", MediaCors.headers("  ").get("Access-Control-Allow-Origin"));
    }
}
