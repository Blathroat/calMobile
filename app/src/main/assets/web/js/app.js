/**
 * 应用入口：注册路由、启动导航。
 * 页面模块与 newUI 的屏幕编号一一对应，便于对照线框逐屏回归。
 */

import { state, whenReady, hasNative, refreshUser } from './core/bridge.js';
import { defineRoute, start, render, onRouteChange } from './core/router.js';
import { toast } from './ui/components.js';
import { qs, el, append } from './core/dom.js';

import { loginPage } from './pages/login.js';
import { registerPage } from './pages/register.js';
import { homePage } from './pages/home.js';
import { detailPage } from './pages/detail.js';
import { registrationFormPage } from './pages/registration-form.js';
import { searchPage } from './pages/search.js';
import { myRegistrationsPage } from './pages/my-registrations.js';
import { registrationDetailPage } from './pages/registration-detail.js';
import { profilePage } from './pages/profile.js';
import { exhibitorPage } from './pages/exhibitor.js';
import { exhibitionFormPage } from './pages/exhibition-form.js';
import { richEditorPage } from './pages/rich-editor.js';
import { reviewPage } from './pages/review.js';
import { userPublicPage } from './pages/user-public.js';
import { adminPage } from './pages/admin.js';

// 屏幕 01–17 与 newUI 线框的对应关系写在每个模块头部。
// 管理-展会与管理-设置已内联到管理后台与个人页，不再保留二级页面。
defineRoute('login', { title: '登录', render: loginPage });
defineRoute('register', { title: '注册', render: registerPage });
defineRoute('home', { title: '首页', render: homePage });
defineRoute('detail', { title: '展会详情', render: detailPage });
defineRoute('registration-form', { title: '报名信息', render: registrationFormPage, requires: 'auth' });
defineRoute('search', { title: '搜索', render: searchPage });
defineRoute('my-registrations', { title: '我的报名', render: myRegistrationsPage });
defineRoute('registration-detail', { title: '报名详情', render: registrationDetailPage, requires: 'auth' });
defineRoute('profile', { title: '个人主页', render: profilePage });
defineRoute('exhibitor', { title: '展商后台', render: exhibitorPage, roles: ['exhibitor', 'admin'] });
defineRoute('exhibition-form', { title: '编辑展会', render: exhibitionFormPage, roles: ['exhibitor', 'admin'] });
defineRoute('rich-editor', { title: '编辑展会简介', render: richEditorPage, roles: ['exhibitor', 'admin'] });
defineRoute('review', { title: '报名管理', render: reviewPage, roles: ['exhibitor', 'admin'] });
defineRoute('user-public', { title: '用户公开页', render: userPublicPage });
defineRoute('admin', { title: '管理后台', render: adminPage, roles: ['admin'] });

// 启动后进入的默认页面：登录态决定入口
onRouteChange(async (route) => {
    if (route?.denied) {
        toast(`当前角色无权访问「${route.denied}」`);
    }
});

async function main() {
    if (hasNative()) {
        await whenReady();
    } else {
        append(qs('#app'), el('div', { class: 'bridge-warning' },
            ['当前在浏览器中预览，原生数据不可用；请在 Android 应用中打开以加载真实业务数据。']));
    }
    const entry = state.user.loggedIn || !state.user.guest ? 'home' : 'login';
    await start(entry);
}

main().catch((error) => {
    console.error(error);
    qs('#app').textContent = `启动失败：${error.message}`;
});

// 退出登录等操作后重新拉取用户态
export async function syncUser() {
    if (hasNative()) {
        await refreshUser();
    }
    return render();
}
