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
- 界面文案写入 `web/src/i18n/zh.json`，用 `t('auth.login.title')` 这种点分路径读取。邮件正文写在后端，不进这张表。部署不上传这个源文件，文案在构建时打进页面包。用户安装的语言包在本机，更新页面不会覆盖。
- 写接口返回 `{ ok, error, ... }`。规则失败用 200 + `ok:false`，认证授权用 4xx，数据库不可用用 503。响应只用给用户看的文案。

## 命名

Java 四空格，类名 PascalCase，成员 camelCase，资源 `snake_case`。前端 class 与页面文件用 kebab-case。注释和文档用中文。

## 分支与提交

尽量照着一个分支做变更，不要每件事新开分支。本地提交可以每做完一块就提交一次，用简洁中文动词短句，只提交本次路径。

推送、开 PR、合并都要用户明确要求或同意，不要自行操作。推送后等 CI 跑完并成功，失败就改到成功。要合并时，先等这次推送的 CI 成功再提 PR；PR 自己的 CI 也要成功才能合入，检查还在跑或失败时不要合并。合入 `master` 后确认 CD 通过。

## 发布

会让 CD 发布客户端、部署服务或同步页面的提交不要直接推到 `master`。走 PR，用合并提交合入。直接推上去的普通提交不会发布。文档和测试不触发 CD。哪些路径会触发，见 [docs/operations.md](docs/operations.md)。已经在 `master` 上且 CI 通过的提交要补发时，在 Actions 里手动运行 Release。不要撤回合并，也不要为了凑路径去改文件。

## 文档

文档只写当前行为。产品、工程、上线分别写入上面三份文件。协作配置在 `docs/agents/`。

## Agent skills

- 建、读、列、评论、关闭工单，或处理外部 PR、wayfinder 地图时，读 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- 给工单打分流标签时，读 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)。
- 摸代码库、选用领域词或记下决定时，读 [docs/agents/domain.md](docs/agents/domain.md)。
