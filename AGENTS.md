# Repository Guidelines

## 项目结构

Android 客户端位于 `app/`，使用 Java 17。启动页是 `WebShellActivity`，它是承载 `newUI/` 设计的 WebView 容器；前端页面、样式与脚本位于 `app/src/main/assets/web/`，Android 侧业务与系统能力位于 `app/src/main/java/com/example/calmobile/`。旧 Java/XML 页面归档在 `java/com/example/calmobile/legacy/`，保留编译与清单注册，仅用于对照与回退。原生资源仍在 `app/src/main/res/`，单元测试在 `app/src/test/`。`server/` 是独立的 Node.js、Express 与 PostgreSQL 服务，不属于 Gradle 模块。项目说明、架构、需求、设计令牌和路线图统一维护在根目录 `README.md`，后端运行细节维护在 `server/README.md`。

## 构建、测试与开发

在仓库根目录运行：

```bash
node scripts/smoke-check.js
node scripts/webui-check.js
node --test scripts/smoke-check.test.js
gradlew.bat :app:testDebugUnitTest
gradlew.bat :app:assembleDebug
```

`smoke-check` 校验清单入口、桥接契约、15 个页面模块、设计令牌、动效层、内置依赖与文档关键内容；`webui-check` 校验前端 ES 模块能否解析、动作名是否都有原生实现；`smoke-check.test.js` 是检查脚本自身的单元测试。POSIX 环境使用 `./gradlew`。后端进入 `server/` 后运行 `npm install`、`npm run db:migrate`、`npm run dev`；测试使用 `npm test -- --runInBand`，风格检查使用 `npm run lint`。本地 PostgreSQL 配置参考 `server/.env.example`，禁止提交 `.env`、密钥或真实用户数据。

## 编码与界面规范

Java 使用四空格缩进；类名使用 PascalCase，方法、变量使用 camelCase，资源名使用 `snake_case`。前端 CSS 类使用 kebab-case，页面模块使用 kebab-case 文件名。用户可见文案优先复用 `strings.xml` 与页面内的中文常量，新增文档和注释使用中文。沿用 newUI 令牌（`#F7F6F3` 背景、`#FFFFFF` 页面、`#20252B` 主文字、`#626A74` 次文字、`#C5CAD1` 描边、`#48515D` 主按钮、`#C05621` 强调色），颜色、字号、间距、圆角只在 `styles/tokens.css` 声明，交互动效只在 `styles/motion.css` 声明，页面不重复定义；强调色只能通过 `--accent*` 变量使用，不得写死具体色值，否则管理员配色会失效。线框尺寸按 390dp 逻辑宽度等比换算，触控区域不小于 44px；展会图片按设计稿的 1080×1920（9:16）竖向比例展示；顶部导航栏统一使用 `--topbar-h` 高度，不要在标题下加装饰线。并排字段用 `.grid-cols-2`（flex 等高）保证输入框对齐。日期、时间和状态选择使用选择器、分段控件或页内面板，不使用下划线输入框；切换类控件使用 `segmented()` 的滑动滑块，不重建 DOM。动态展开内容必须出现在触发卡片附近，并提供选中、禁用、错误、加载和完成反馈。Markdown 与 HTML 渲染前必须经过 `js/core/sanitize.js` 清洗，渲染 Markdown 用 `core/markdown.js` 的 `renderMarkdown`（会自动按需加载引擎）。第三方前端库必须内置到 `assets/web/vendor/` 并记录版本与许可证，不引用 CDN 或图标字体。

## 测试与提交

Android 改动按 smoke-check、webui-check、单元测试、调试构建的顺序验证；聚焦测试可使用 `:app:testDebugUnitTest --tests '包名.测试类'`。涉及界面时使用可用的模拟器进行 ADB 回归，仓库内可用 `pwsh -File scripts\emu.ps1` 完成安装、截图与按文字点击。提交信息使用简洁中文动词短句，例如 `重构前端为 WebView`。合并请求需说明用户可见变化、验证命令和结果；界面改动附截图或录屏并关联问题。

## 架构与工作区

前端为 WebView 页面（HTML/CSS/ES 模块），通过 `WebAppBridge`/`WebAppActions` 调用原生业务；展会、报名和用户数据使用 SQLite，并在数据库不可用时回退到内存示例数据；应用设置、个人资料与上传的媒体文件使用 SharedPreferences 与应用私有目录 `files/media`（通过 `https://appassets.androidplatform.net/media/<文件名>` 引用，由 `WebShellActivity` 拦截放行）。新增页面时同时更新 `assets/web/js/app.js` 的路由注册、`README.md` 的屏幕对照表和 `scripts/smoke-check.js`、`scripts/webui-check.js` 的页面清单；管理类功能优先内联到现有页面，不新增二级页面。管理员在「管理-设置」中维护的是服务器级配置（软件中英文标题、公告、分类、审核策略、媒体与上传限制、表单字符数上限），保存后对所有用户生效；应用配色属于个人偏好，放在个人页的「设置」栏。表单校验统一走 `js/core/validate.js`，长度上限取自 `state.limits`，原生侧保存前再校验一次。Room、Retrofit、Repository 与 ViewModel 已搭建但尚未接入全部页面，后端 API 也未替换本地演示流。修改认证、持久化、导航、包名、签名或引入新框架前先确认。工作区可能包含其他任务的改动，只检查并提交本次涉及路径，不回退无关文件；`build/`、`.gradle-local/`、`.idea/`、`.omo/`、`.opencode/`、日志与 APK 已在 `.gitignore` 中，不要把它们加入提交，也不要为了“干净”删除本机缓存目录。

## 文档维护

新增或更新需求先修改 `README.md`，不要再创建重复的需求、架构或 Review 文档。设计稿与实现的冲突记录在 `README.md` 的「冲突与待裁决清单」，未确认前不要擅自扩大数据模型。代码行为、依赖或命令变化后同步更新对应说明，并运行 `node scripts/smoke-check.js` 与 `node scripts/webui-check.js`。
