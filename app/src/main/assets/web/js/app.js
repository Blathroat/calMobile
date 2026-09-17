import { t } from './core/strings.js';
/**
 * 应用入口：注册路由、启动导航。
 * 页面模块与 newUI 的屏幕编号一一对应，便于对照线框逐屏回归。
 */

import { state, whenReady, bootReady, hasNative, mark, reportTimings } from './core/bridge.js';
import { defineRoute, start, render, navigate, onRouteChange } from './core/router.js';
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
import { checkinPage } from './pages/checkin.js';

// 屏幕 01–17 与 newUI 线框的对应关系写在每个模块头部。
// 管理-展会与管理-设置已内联到管理后台与个人页，不再保留二级页面。
defineRoute('login', { title: t('s_1yggxgd'), render: loginPage });
defineRoute('register', { title: t('s_1n008jl'), render: registerPage });
defineRoute('home', { title: t('s_1ow5v10'), render: homePage });
defineRoute('detail', { title: t('s_1ve1f4n'), render: detailPage });
defineRoute('registration-form', { title: t('s_vrp4t3'), render: registrationFormPage, requires: 'auth' });
defineRoute('search', { title: t('s_367f3v'), render: searchPage });
defineRoute('my-registrations', { title: t('s_1m2dh8u'), render: myRegistrationsPage });
defineRoute('registration-detail', { title: t('s_1e7myaa'), render: registrationDetailPage, requires: 'auth' });
defineRoute('profile', { title: t('s_1kzh3gd'), render: profilePage });
defineRoute('exhibitor', { title: t('s_1omalh8'), render: exhibitorPage, roles: ['exhibitor', 'admin'] });
defineRoute('exhibition-form', { title: t('s_eutzzb'), render: exhibitionFormPage, roles: ['exhibitor', 'admin'] });
defineRoute('rich-editor', { title: t('s_28v8q'), render: richEditorPage, roles: ['exhibitor', 'admin'] });
defineRoute('review', { title: t('s_7xrrf0'), render: reviewPage, roles: ['exhibitor', 'admin'] });
// 核销报名码属于展商后台的现场工具，不单独占一屏设计稿。
defineRoute('checkin', { title: t('s_zqzoiq'), render: checkinPage, roles: ['exhibitor', 'admin'] });
defineRoute('user-public', { title: t('s_1g1m28r'), render: userPublicPage });
defineRoute('admin', { title: t('s_cit5ds'), render: adminPage, roles: ['admin'] });

// 启动后进入的默认页面：登录态决定入口
onRouteChange(async (route) => {
    if (route?.denied) {
        toast(`当前角色无权访问「${route.denied}」`);
    }
});

/**
 * 启动流程。
 *
 * 首帧**不等** bootstrap：bootstrap 可能是一次远端请求，等它会把启动拖成白屏
 * （`WebAppActions` 挂起时甚至永远不返回）。这里的顺序是：
 *
 * 1. 立即按已知状态渲染入口页（通常是登录页）；
 * 2. bootstrap 落定后，如果登录态与当前页面不符，再纠正到正确入口。
 */
async function main() {
    mark('main-start');
    // 先等原生桥接就绪（不等 bootstrap），再按已知状态渲染首帧。
    await whenReady();
    mark('ready');
    const entry = state.user.loggedIn || !state.user.guest ? 'home' : 'login';
    const first = start(entry);

    if (!hasNative()) {
        append(qs('#app'), el('div', { class: 'bridge-warning' },
            [t('s_p44duo')]));
    }

    // bootstrap 数据落定后再纠正入口页（替换历史，不新增返回栈）。
    bootReady().then(() => {
        const target = state.user.loggedIn || !state.user.guest ? 'home' : 'login';
        if (target !== entry) {
            navigate(target, {}, { replace: true });
        }
        mark('entered');
        reportTimings();
    });

    return first;
}

main().catch((error) => {
    console.error(error);
    qs('#app').textContent = `启动失败：${error.message}`;
});
