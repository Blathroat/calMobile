# Issue tracker: GitHub

本仓库的工单与 spec 存在 GitHub Issues。所有操作走 `gh` CLI。

## 约定

- **建工单**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读工单**：`gh issue view <number> --comments`，用 `jq` 过滤评论，并取 labels。
- **列工单**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state`。
- **评论**：`gh issue comment <number> --body "..."`
- **加 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断；在 clone 里跑 `gh` 会自动认。

## Pull requests as a triage surface

**PRs as a request surface: no.** _（若本仓库把外部 PR 当功能请求，改成 `yes`；`/triage` 读这个开关。）_

设为 `yes` 时，PR 走与 issue 相同的标签和状态，用 `gh pr` 对应命令：

- **读 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分流的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE`（丢掉 `OWNER` / `MEMBER` / `COLLABORATOR`）。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一套编号，裸 `#42` 可能是其中任一：先 `gh pr view 42`，不行再 `gh issue view 42`。

## 技能说「publish to the issue tracker」时

建一条 GitHub issue。

## 技能说「fetch the relevant ticket」时

跑 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一条 issue，子工单是它的 child issues。

- **Map**：一条打了 `wayfinder:map` 的 issue，正文含 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：用 GitHub sub-issue 挂到 map 上（`gh api` 打 sub-issues 接口）。未开 sub-issues 时，把子项写进 map 正文的 task list，并在子工单正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。认领后把工单 assign 给正在推进的开发者。
- **阻塞**：用 GitHub **native issue dependencies**，这是界面上可见的权威表示。加边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，不是 `#number` 也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by` 报告（只计未关闭的阻塞，即当前门闩）。依赖不可用时，退回在子工单正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭后，该工单才算 unblock。
- **Frontier 查询**：列出 map 的未关闭 children（`gh issue list --state open`，范围是 map 的 sub-issues / task list），丢掉仍有未关闭阻塞的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里还有未关闭 issue）以及已有 assignee 的；map 顺序里第一条胜出。
- **认领**：`gh issue edit <n> --add-assignee @me`，本会话第一次写入。
- **了结**：`gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，然后在 map 的 Decisions-so-far 追加一条 context pointer（要点 + 链接）。
