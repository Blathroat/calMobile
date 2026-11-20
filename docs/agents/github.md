# GitHub 工单与分流

工单与 spec 存在 GitHub Issues，所有操作走 `gh` CLI。仓库从 `git remote -v` 推断，在 clone 里直接跑 `gh` 即可。

## gh 约定

- **建工单**：`gh issue create --title "..." --body "..."`，多行正文用 heredoc。
- **读工单**：`gh issue view <number> --comments`，评论用 `jq` 过滤，labels 一并取。
- **列工单**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state`。
- **评论**：`gh issue comment <number> --body "..."`。
- **加 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：`gh issue close <number> --comment "..."`。

Issue 与 PR 共用编号，裸 `#42` 可能是其中任一：先 `gh pr view 42`，不行再 `gh issue view 42`。

## PR

外部 PR 不作为功能请求，不按 issue 分流。读 PR 用 `gh pr view <number> --comments`，diff 用 `gh pr diff <number>`；评论、标签、关闭用 `gh pr comment` / `gh pr edit --add-label`、`--remove-label` / `gh pr close`。

## 技能里的说法

- 「publish to the issue tracker」：建一条 GitHub issue。
- 「fetch the relevant ticket」：跑 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一条 issue，子工单是它的 child issues。

- **Map**：一条打了 `wayfinder:map` 的 issue，正文含 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：用 GitHub sub-issue 挂到 map 上（`gh api` 打 sub-issues 接口）。未开 sub-issues 时，把子项写进 map 正文的 task list，并在子工单正文顶部写 `Part of #<map>`。标签 `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。认领后把工单 assign 给正在推进的开发者。
- **阻塞**：用 GitHub native issue dependencies，这是界面上可见的权威表示。加边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 database id（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number`，也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by` 报告未关闭的阻塞，即当前门闩。依赖不可用时，退回在子工单正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭后，该工单才算 unblock。
- **Frontier 查询**：列出 map 的未关闭 children（`gh issue list --state open`，范围是 map 的 sub-issues / task list），丢掉仍有未关闭阻塞的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里还有未关闭 issue）以及已有 assignee 的；map 顺序里第一条胜出。
- **认领**：`gh issue edit <n> --add-assignee @me`，本会话第一次写入。
- **了结**：`gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，然后在 map 的 Decisions-so-far 追加一条 context pointer（要点 + 链接）。

## 分流标签

技能用五个分流角色说话，本仓库的标签字符串就是这几个角色名，按下表直接使用：

| 标签 | 含义 |
| --- | --- |
| `needs-triage` | 维护者需要评估这条 issue |
| `needs-info` | 等报告者补充信息 |
| `ready-for-agent` | 规格已齐，可交给无人值守 agent |
| `ready-for-human` | 需要人来实现 |
| `wontfix` | 不会跟进 |

改词汇时只改这张表，与 tracker 里实际使用的标签对齐。
