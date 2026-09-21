# Domain Docs

工程技能在摸代码库时，按这里消费本仓库的领域文档。

## 动手探索前先读这些

- 仓库根目录的 **`CONTEXT.md`**，或
- 根目录若有 **`CONTEXT-MAP.md`**：它指向每个上下文一份 `CONTEXT.md`。读与当前主题相关的那些。
- **`docs/adr/`**：读会碰到你即将动手区域的 ADR。多上下文仓库还要看 `src/<context>/docs/adr/` 里该上下文的决策。

这些文件若还不存在，**安静继续**。不要报缺；不要建议先去建。`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）会在术语或决策真正敲定后再惰性创建。

## 文件结构

本仓库是 single-context（绝大多数仓库如此）：

```
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-server-hono-typescript.md
├── app/
└── server/
```

若根目录出现 `CONTEXT-MAP.md`，才按 multi-context 读：系统级决策在 `docs/adr/`，各上下文自己的 `CONTEXT.md` 与 ADR 在对应目录下。

## 用词表里的词汇

输出里点名领域概念时（issue 标题、重构提案、假设、测试名），用 `CONTEXT.md` 里定义的那个词。不要滑到词表明确避开的同义词。

需要的概念还不在词表里，这是信号：要么你在发明项目不用的说法（重新考虑），要么是真缺口（记下来给 `/domain-modeling`）。

## 标出与 ADR 的冲突

若输出与已有 ADR 矛盾，明确摊开，不要默默覆盖：

> _与 ADR-0007（……）矛盾，但值得重开，因为……_
