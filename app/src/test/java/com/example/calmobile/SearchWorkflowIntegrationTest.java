package com.example.calmobile;

import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/**
 * Integration tests for the search workflow: search → filter → view.
 *
 * Tests exercise search across ExhibitionManager and AdminUserManager,
 * verifying that queries correctly filter results and that found items
 * can be viewed with complete data.
 */
public class SearchWorkflowIntegrationTest {

    @Before
    public void resetStaticState() throws Exception {
        // Reset ExhibitionManager
        Field exExhibitions = ExhibitionManager.class.getDeclaredField("fallbackExhibitions");
        exExhibitions.setAccessible(true);
        ((List<?>) exExhibitions.get(null)).clear();

        Field exNextId = ExhibitionManager.class.getDeclaredField("fallbackNextId");
        exNextId.setAccessible(true);
        exNextId.setInt(null, 1);

        Field exInitialized = ExhibitionManager.class.getDeclaredField("initialized");
        exInitialized.setAccessible(true);
        exInitialized.setBoolean(null, false);

        // Reset AdminUserManager
        Field usUsers = AdminUserManager.class.getDeclaredField("fallbackUsers");
        usUsers.setAccessible(true);
        ((List<?>) usUsers.get(null)).clear();

        Field usNextId = AdminUserManager.class.getDeclaredField("fallbackNextId");
        usNextId.setAccessible(true);
        usNextId.setInt(null, 1);

        Field usInitialized = AdminUserManager.class.getDeclaredField("initialized");
        usInitialized.setAccessible(true);
        usInitialized.setBoolean(null, false);
    }

    // ── Exhibition search: search → filter → view ─────────────────

    @Test
    public void exhibitionSearchByTitleAndViewResult() {
        // Setup: create exhibitions
        ExhibitionManager.add(1, "智能家居博览会", "深圳会展中心", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "智能设备展示", "智能家居");
        ExhibitionManager.add(2, "物流技术峰会", "广州琶洲展馆", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV展示", "物流技术");
        ExhibitionManager.add(3, "数字健康大会", "上海国家会展中心", "11:00",
                ExhibitorExhibition.STATUS_CLOSED, "医疗AI", "医疗健康");

        // Search by title keyword
        List<ExhibitorExhibition> results = ExhibitionManager.search("智能");
        assertEquals(1, results.size());

        // View the result — verify all fields are accessible
        ExhibitorExhibition found = results.get(0);
        assertEquals("智能家居博览会", found.getTitle());
        assertEquals("深圳会展中心", found.getVenue());
        assertEquals(1, found.getDay());
        assertEquals("09:00", found.getTime());
        assertEquals(ExhibitorExhibition.STATUS_OPEN, found.getStatus());
        assertEquals("智能设备展示", found.getDescription());
        assertEquals("智能家居", found.getCategory());
    }

    @Test
    public void exhibitionSearchByVenueAndViewResult() {
        ExhibitionManager.add(1, "展会A", "深圳会展中心", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        ExhibitionManager.add(2, "展会B", "广州琶洲展馆", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        ExhibitionManager.add(3, "展会C", "上海国家会展中心", "11:00",
                ExhibitorExhibition.STATUS_CLOSED, "描述", "分类");

        List<ExhibitorExhibition> results = ExhibitionManager.search("琶洲");
        assertEquals(1, results.size());
        assertEquals("展会B", results.get(0).getTitle());
        assertEquals("广州琶洲展馆", results.get(0).getVenue());
    }

    @Test
    public void exhibitionSearchByCategoryAndViewResult() {
        ExhibitionManager.add(1, "展会A", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "智能家居");
        ExhibitionManager.add(2, "展会B", "场馆", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "物流技术");
        ExhibitionManager.add(3, "展会C", "场馆", "11:00",
                ExhibitorExhibition.STATUS_CLOSED, "描述", "智能家居");

        List<ExhibitorExhibition> results = ExhibitionManager.search("物流");
        assertEquals(1, results.size());
        assertEquals("展会B", results.get(0).getTitle());
    }

    @Test
    public void exhibitionSearchByDescriptionAndViewResult() {
        ExhibitionManager.add(1, "展会A", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "碳纤维新材料展示", "新材料");
        ExhibitionManager.add(2, "展会B", "场馆", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV仓储机器人", "物流技术");

        List<ExhibitorExhibition> results = ExhibitionManager.search("碳纤维");
        assertEquals(1, results.size());
        assertEquals("展会A", results.get(0).getTitle());
    }

    @Test
    public void exhibitionSearchReturnsMultipleMatches() {
        ExhibitionManager.add(1, "智能家居展A", "深圳", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        ExhibitionManager.add(2, "智能家居展B", "广州", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");
        ExhibitionManager.add(3, "物流技术展", "上海", "11:00",
                ExhibitorExhibition.STATUS_CLOSED, "描述", "分类");

        List<ExhibitorExhibition> results = ExhibitionManager.search("智能");
        assertEquals(2, results.size());
    }

    @Test
    public void exhibitionSearchIsCaseInsensitive() {
        ExhibitionManager.add(1, "Smart Home Expo", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        // Search with different cases
        List<ExhibitorExhibition> results1 = ExhibitionManager.search("smart");
        List<ExhibitorExhibition> results2 = ExhibitionManager.search("SMART");
        List<ExhibitorExhibition> results3 = ExhibitionManager.search("Smart");

        assertEquals(1, results1.size());
        assertEquals(1, results2.size());
        assertEquals(1, results3.size());
    }

    @Test
    public void exhibitionSearchReturnsEmptyForNoMatch() {
        ExhibitionManager.add(1, "展会", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        List<ExhibitorExhibition> results = ExhibitionManager.search("不存在的关键词");
        assertTrue(results.isEmpty());
    }

    @Test
    public void exhibitionSearchReturnsEmptyForNullQuery() {
        ExhibitionManager.add(1, "展会", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        assertTrue(ExhibitionManager.search(null).isEmpty());
    }

    @Test
    public void exhibitionSearchReturnsEmptyForEmptyQuery() {
        ExhibitionManager.add(1, "展会", "场馆", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "描述", "分类");

        assertTrue(ExhibitionManager.search("").isEmpty());
        assertTrue(ExhibitionManager.search("   ").isEmpty());
    }

    @Test
    public void exhibitionSearchAndViewFullDetailsAfterFilter() {
        // Create exhibition with rich data
        ExhibitionManager.add(8, "华南智能家居展", "深圳会展中心 3 号馆", "09:00-17:30",
                ExhibitorExhibition.STATUS_OPEN, "智能门锁、全屋方案和节能家电集中展示。", "智能家居");
        ExhibitionManager.add(15, "大湾区物流技术展", "广州琶洲展馆 C 区", "10:00-18:00",
                ExhibitorExhibition.STATUS_OPEN, "AGV、仓储机器人与冷链物流方案。", "物流技术");

        // Search and view full details
        List<ExhibitorExhibition> results = ExhibitionManager.search("华南");
        assertEquals(1, results.size());

        ExhibitorExhibition ex = results.get(0);
        assertEquals(8, ex.getDay());
        assertEquals("华南智能家居展", ex.getTitle());
        assertEquals("深圳会展中心 3 号馆", ex.getVenue());
        assertEquals("09:00-17:30", ex.getTime());
        assertEquals(ExhibitorExhibition.STATUS_OPEN, ex.getStatus());
        assertEquals("智能门锁、全屋方案和节能家电集中展示。", ex.getDescription());
        assertEquals("智能家居", ex.getCategory());

        // Also verify registration records are accessible for the found exhibition
        List<String> records = ExhibitionManager.getRegistrationRecords(ex);
        assertNotNull(records);
        assertFalse(records.isEmpty());
    }

    // ── User search: search → filter → view ───────────────────────

    @Test
    public void userSearchByNicknameAndViewResult() {
        AdminUserManager.add("张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-15 09:30", "2026-06-12 14:20");
        AdminUserManager.add("李娜", "lina@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-20 11:00", "2026-06-11 10:15");

        List<AdminUser> results = AdminUserManager.search("张伟");
        assertEquals(1, results.size());

        // View full details
        AdminUser found = results.get(0);
        assertEquals("张伟", found.getNickname());
        assertEquals("zhangwei@example.com", found.getEmail());
        assertEquals(AdminUser.STATUS_ACTIVE, found.getStatus());
        assertEquals("2025-01-15 09:30", found.getRegistrationTime());
        assertEquals("2026-06-12 14:20", found.getLastLoginTime());
        assertTrue(found.isActive());
    }

    @Test
    public void userSearchByEmailAndViewResult() {
        AdminUserManager.add("张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-15", "2026-06-12");
        AdminUserManager.add("李娜", "lina@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-20", "2026-06-11");

        List<AdminUser> results = AdminUserManager.search("lina@");
        assertEquals(1, results.size());
        assertEquals("李娜", results.get(0).getNickname());
    }

    @Test
    public void userSearchReturnsMultipleMatches() {
        AdminUserManager.add("张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.add("张三", "zhangsan@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-01", "2026-06-01");
        AdminUserManager.add("李娜", "lina@example.com",
                AdminUser.STATUS_ACTIVE, "2025-03-01", "2026-06-01");

        List<AdminUser> results = AdminUserManager.search("张");
        assertEquals(2, results.size());
    }

    @Test
    public void userSearchIsCaseInsensitive() {
        AdminUserManager.add("TestUser", "Test@Example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");

        assertEquals(1, AdminUserManager.search("testuser").size());
        assertEquals(1, AdminUserManager.search("TESTUSER").size());
        assertEquals(1, AdminUserManager.search("test@example").size());
    }

    @Test
    public void userSearchIncludesAllStatuses() {
        AdminUserManager.add("活跃用户", "active@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.add("封禁用户", "banned@example.com",
                AdminUser.STATUS_BANNED, "2025-02-01", "2026-06-01");
        AdminUserManager.add("受限用户", "restricted@example.com",
                AdminUser.STATUS_RESTRICTED, "2025-03-01", "2026-06-01");

        // Search should find users regardless of status
        List<AdminUser> activeResults = AdminUserManager.search("活跃");
        assertEquals(1, activeResults.size());
        assertEquals(AdminUser.STATUS_ACTIVE, activeResults.get(0).getStatus());

        List<AdminUser> bannedResults = AdminUserManager.search("封禁");
        assertEquals(1, bannedResults.size());
        assertEquals(AdminUser.STATUS_BANNED, bannedResults.get(0).getStatus());

        List<AdminUser> restrictedResults = AdminUserManager.search("受限");
        assertEquals(1, restrictedResults.size());
        assertEquals(AdminUser.STATUS_RESTRICTED, restrictedResults.get(0).getStatus());
    }

    @Test
    public void userSearchReturnsEmptyForNoMatch() {
        AdminUserManager.add("张伟", "zhangwei@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");

        assertTrue(AdminUserManager.search("不存在").isEmpty());
    }

    @Test
    public void userSearchReturnsEmptyForNullAndEmpty() {
        AdminUserManager.add("用户", "user@example.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");

        assertTrue(AdminUserManager.search(null).isEmpty());
        assertTrue(AdminUserManager.search("").isEmpty());
        assertTrue(AdminUserManager.search("   ").isEmpty());
    }

    // ── Combined search workflow: create data, search, filter, view ──

    @Test
    public void combinedSearchWorkflowExhibitionsAndUsers() {
        // Create a set of exhibitions
        ExhibitionManager.add(1, "智能家居展", "深圳", "09:00",
                ExhibitorExhibition.STATUS_OPEN, "智能设备", "智能家居");
        ExhibitionManager.add(2, "物流峰会", "广州", "10:00",
                ExhibitorExhibition.STATUS_OPEN, "仓储方案", "物流技术");
        ExhibitionManager.add(3, "健康大会", "上海", "11:00",
                ExhibitorExhibition.STATUS_CLOSED, "医疗AI", "医疗健康");

        // Create a set of users
        AdminUserManager.add("展会管理员", "admin@expo.com",
                AdminUser.STATUS_ACTIVE, "2025-01-01", "2026-06-01");
        AdminUserManager.add("普通观众", "visitor@example.com",
                AdminUser.STATUS_ACTIVE, "2025-02-01", "2026-06-01");

        // Search exhibitions by keyword
        List<ExhibitorExhibition> exResults = ExhibitionManager.search("智能");
        assertEquals(1, exResults.size());
        assertEquals("智能家居展", exResults.get(0).getTitle());

        // Search users by keyword
        List<AdminUser> userResults = AdminUserManager.search("管理员");
        assertEquals(1, userResults.size());
        assertEquals("展会管理员", userResults.get(0).getNickname());

        // Verify complete data is accessible after search
        ExhibitorExhibition foundEx = exResults.get(0);
        assertNotNull(foundEx.getId());
        assertEquals("深圳", foundEx.getVenue());

        AdminUser foundUser = userResults.get(0);
        assertNotNull(foundUser.getId());
        assertEquals("admin@expo.com", foundUser.getEmail());
    }
}
