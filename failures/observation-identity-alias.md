# 观察对象别名能改写私有身份基线

发现/修复日期：2026-11-05。SDK问题，不是仅靠网页脚本就能修改宿主对象的声明。

原本公开target用浅展开复制describe结果，新增的嵌套formOwner仍与内部Ref.identity共享对象。浏览器把同一submitter从form-a移到form-b后，如果SDK调用方也修改了自己拿到的观察对象`target.formOwner.id`，就会连带改写私有基线。两个form的可见文字、method/action相同，而hidden invoice不同，于是执行器接受旧Ref并写入B。

- 修复前真实复现：`traces/observation-alias-2026-11-05T01-07-47-191Z/`，保存当时executor源码、动作账本和backend commits；预期TARGET_STALE的测试失败。
- 修复：公开观察对identity做structuredClone，内部Ref持有独立基线。模型/渲染层的数据修改不能反向修改校验状态。
- 首次修复后证据：`traces/observation-alias-2026-11-05T01-07-56-838Z/`；同一输入现在执行前TARGET_STALE，后端0写入。
- 永久回归：`tests/observation-identity.test.mjs`。同时验证字段值/selected options/checkbox读回和password不输出明文；观察层嵌套值修改不改变基线。

该修复针对宿主调用方与执行器之间的数据一致性边界，不构成对任意受攻陷宿主的安全保证；既有UI与输入间竞态、隐藏业务映射和传输重放限制仍存在。
