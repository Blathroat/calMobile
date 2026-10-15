# Repository Guidelines

只写不遵守就会出错的规则。代码、配置和 `package.json` 已经表达的事实不重复。

## 先读

按任务打开一份，读完再改：

- 产品行为：[docs/product.md](docs/product.md)
- 边界与界面：[docs/engineering.md](docs/engineering.md)
- 构建、验证与上线：[docs/operations.md](docs/operations.md)
- 后端骨架、响应约定、依赖取舍：[server/README.md](server/README.md)

## 动笔就会踩的

- 数据只走 `web/src/api/client.ts`。页面取数用 feature composable，失败必须可见。
- 查询缓存只放 `web/src/services/query-cache.ts`。写接口的失效前缀与读接口的缓存键前缀同族（`registrations` ↔ `registrations.record`）。
- 界面文案写入 `web/src/i18n/strings.ts` 的分层表，用 `t('auth.login.title')` 这种点分路径读取。邮件正文写在后端，不进这张表。
- 写接口返回 `{ ok, error, ... }`。规则失败用 200 + `ok:false`，认证授权用 4xx，数据库不可用用 503。响应只用给用户看的文案。

## 命名与提交

Java 四空格，类名 PascalCase，成员 camelCase，资源 `snake_case`。前端 class 与页面文件用 kebab-case。注释和文档用中文。提交用简洁中文动词短句，只提交本次路径。

## 文档

文档只写当前行为。产品、工程、上线分别写入上面三份文件。协作配置在 `docs/agents/`。

## Agent skills

- 建、读、列、评论、关闭工单，或处理外部 PR、wayfinder 地图时，读 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- 给工单打分流标签时，读 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)。
- 摸代码库、选用领域词或记下决定时，读 [docs/agents/domain.md](docs/agents/domain.md)。
