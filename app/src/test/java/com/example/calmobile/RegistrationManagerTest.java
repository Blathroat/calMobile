package com.example.calmobile;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class RegistrationManagerTest {
    @Test
    public void submitCreatesPendingRegistration() {
        RegistrationManager manager = new RegistrationManager();

        Registration registration = manager.submit(
                "绿色能源装备展",
                12,
                "10:00-18:00",
                "广州琶洲展馆 A 区",
                "张三",
                "采购负责人",
                "需要洽谈，已勾选提醒");

        assertEquals("绿色能源装备展", registration.getExhibitionTitle());
        assertEquals(12, registration.getExhibitionDay());
        assertEquals("张三", registration.getVisitorName());
        assertEquals(Registration.Status.PENDING, registration.getStatus());
    }

    @Test
    public void listReturnsSubmittedRegistrations() {
        RegistrationManager manager = new RegistrationManager();

        Registration first = manager.submit("绿色能源装备展", 12, "10:00-18:00", "广州琶洲展馆 A 区", "张三", "采购负责人", "需要洽谈");
        Registration second = manager.submit("跨境电商选品会", 12, "13:30-20:00", "广州琶洲展馆 B 区", "李四", "专业观众", "仅参观");

        List<Registration> registrations = manager.list();

        assertEquals(2, registrations.size());
        assertEquals(first.getId(), registrations.get(0).getId());
        assertEquals(second.getId(), registrations.get(1).getId());
    }

    @Test
    public void cancelChangesStatusToCancelled() {
        RegistrationManager manager = new RegistrationManager();
        Registration registration = manager.submit("绿色能源装备展", 12, "10:00-18:00", "广州琶洲展馆 A 区", "张三", "采购负责人", "需要洽谈");

        assertTrue(manager.cancel(registration.getId()));

        assertEquals(Registration.Status.CANCELLED, manager.list().get(0).getStatus());
    }

    @Test
    public void cancelUnknownIdIsSafe() {
        RegistrationManager manager = new RegistrationManager();

        assertEquals(false, manager.cancel("missing-id"));
        assertTrue(manager.list().isEmpty());
    }
}
