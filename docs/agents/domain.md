# Domain Docs

工程技能在摸代码库时，按这里消费本仓库的领域文档。

## 动手探索前先读这些

- [`docs/product.md`](../product.md)、[`docs/engineering.md`](../engineering.md)、[`docs/operations.md`](../operations.md)。后端细节看 [`server/README.md`](../../server/README.md)，其中包含依赖取舍。
- 仓库根目录的 **`CONTEXT.md`**，或根目录若有 **`CONTEXT-MAP.md`**：它指向每个上下文一份 `CONTEXT.md`。读与当前主题相关的那些。

这些文件若还不存在，**安静继续**。不要报缺；不要建议先去建。`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）会在术语或决策真正敲定后再惰性创建。

## 文件结构

本仓库是 single-context（绝大多数仓库如此）：

```
/
├── docs/
│   ├── product.md
│   ├── engineering.md
│   ├── operations.md
│   └── agents/
├── app/
├── web/
└── server/
```

若根目录出现 `CONTEXT-MAP.md`，才按 multi-context 读：各上下文自己的 `CONTEXT.md` 在对应目录下。

## 用词表里的词汇

输出里点名领域概念时（issue 标题、重构提案、假设、测试名），用 `CONTEXT.md` 里定义的那个词。不要滑到词表明确避开的同义词。

需要的概念还不在词表里，这是信号：要么你在发明项目不用的说法（重新考虑），要么是真缺口（记下来给 `/domain-modeling`）。

## 标出与已写决定的冲突

若输出与 `server/README.md` 或上述三份文档里写明的决定矛盾，明确摊开，不要默默覆盖：

> _与 server/README 的依赖取舍矛盾，但值得重开，因为……_
