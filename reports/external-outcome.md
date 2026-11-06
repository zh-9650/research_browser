# 开放互联网只读任务的多证据裁判

真实 Chrome 读取 pytest 8.4.x 官方指南及相邻的 monkeypatch 页面。gpt-5.6-sol / low 从浏览器捕获的公开内容中回答 `tmp_path` 的唯一性粒度、返回类型与来源。宿主独立从上游 8.4.2 标签获取原始 RST，模型观察中未包含这份原始文件。两份文档属于同一上游，分别通过发布文档和源码通道获取。

模型回答每个测试函数各有独立临时目录，类型为 `pathlib.Path`，并提交了正确页面地址及证据摘要。裁判验证来源、摘要和两份资料的事实一致性，判为已验证。模型调用一次，共 18370 tokens。[官方指南](https://docs.pytest.org/en/8.4.x/how-to/tmp_path.html) · [8.4.2 原始文档](https://raw.githubusercontent.com/pytest-dev/pytest/8.4.2/doc/en/how-to/tmp_path.rst)

| 预先标注的对照 | 裁判结果 |
|---|---|
| 正确事实与引用 | 已验证 |
| 把粒度错答为整个会话 | 失败 |
| 引用真实的相邻 monkeypatch 页面 | 失败 |
| 缺失上游证据 | 未知 |
| 上游证据与页面冲突 | 未知 |
| 页面内容变更但摘要保持原值 | 未知 |

首次运行在相邻页面的标题选择器等待超时，未调用模型。改用页面标题选择器后完成。当前裁判规则针对这一题，六个对照是预设反例；独立人工标注、F1、κ 和开放问题泛化仍待验证。

复现命令 `node experiments/external-outcome.mjs gpt-5.6-sol low`。[原始内容、模型决策和对照记录](../traces/external-outcome-2026-11-06T01-20-05-395Z/result.json)
