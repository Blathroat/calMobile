# 领域文档与词表

本文件给 agent 用：摸代码库前读哪些文档、领域概念用哪些词、与已写决定冲突时怎么办。

## 动手探索前先读这些

- [`product.md`](../product.md)：用户可见行为。
- [`engineering.md`](../engineering.md)：客户端与前后端边界、界面实现。
- [`operations.md`](../operations.md)：构建、验证与上线。
- [`server.md`](../server.md)：后端骨架、响应约定、业务规则、数据模型与依赖取舍。
- [`implementation.md`](implementation.md)：文件级实现约束与改动检查清单。

按任务选读，读完再改。

## 文件结构

```
/
├── docs/
│   ├── product.md
│   ├── engineering.md
│   ├── operations.md
│   ├── server.md
│   └── agents/
│       ├── domain.md
│       ├── implementation.md
│       └── github.md
├── app/
├── web/
├── server/
├── deploy/
└── scripts/
```

面向产品、工程、运维与后端的正式文档是 docs 下的这四份；协作规则在 `docs/agents/`。

## 术语表

输出里点名领域概念时（issue 标题、重构提案、假设、测试名），用下面定义的词，不要滑到 Avoid 列的同义词。

**界面文案**：
用户在应用或报名站界面上看见的句子。
_Avoid_: 文案、字符串资源

**邮件正文**：
验证码邮件里写给收件人的句子。
_Avoid_: 界面文案

需要的概念还不在表里，是信号：要么在发明项目不用的说法（重新考虑），要么是真缺口（交给 `/domain-modeling` 补进这张表）。

## 标出与已写决定的冲突

输出与上述文档写明的决定矛盾时，明确摊开，不要默默覆盖：

> _与 server.md 的依赖取舍矛盾，但值得重开，因为……_
