# 架构

本文说明 chest 的两半各自负责什么、数据怎么流、以及几个不显然的设计决策为什么这样定。

## 全局：两个半边，一条 Remote

```
浏览器（packages/client/ui-plugin-shelf）
  ChestSection.tsx        折叠区、两个分区、行与对话框
  index.ts                '@' 触发源、快照 store、导出下载/导入上传
  preference.ts           折叠偏好（localStorage: dsh.chest.expanded）
  contract.ts             槽位契约：注入面 + hooks 面
        │  Typert Remote（13 个方法，改完回传整份列表）
        ▼
Host（packages/host/plugin-shelf）
  index.ts                PluginShelfGateway：方法、序列化队列、快照组装
  plugins.ts              插件包读取、树遍历、.chest 打包/解包、路径安全
  profile.ts              profile 读取与三处改动（依赖 / bundle 层 / 目录链接）
  skills.ts               SKILL.md 解析与渲染、技能根目录扫描
  state.ts                chest.json 记账与顺序应用
  types.ts                线上类型（客户端安全，无 Host-only 符号）
```

Host 侧注册为 `ctx.pluginShelf`，发布 `pluginShelf` Remote 命名空间；客户端通过 `@deepseek-ai/dsh-api-remotes/client` 拿到类型面后调用 `ctx.remote.pluginShelf.*`。

## Remote 接口

| 方法 | 入参 | 返回 |
| --- | --- | --- |
| `list` | — | `ChestSnapshot`：插件、技能、启动时的 profile、是否待重启 |
| `importPlugin` | `ChestPluginRequest`（目录路径 / `.chest` 文档） | `ChestResult` |
| `installPlugin` | `id` | `ChestResult` |
| `uninstallPlugin` | `id` | `ChestResult` |
| `deletePlugin` | `id` | `ChestResult` |
| `reorderPlugins` | `ids` | `ChestResult`（同时重排 profile 的 bundle 槽位） |
| `exportPlugin` | `id` | `ChestExportResult` |
| `createSkill` | `ChestSkillDraft` | `ChestResult` |
| `importSkill` | `ChestBundle` | `ChestResult` |
| `updateSkill` | `id` + `ChestSkillDraft` | `ChestResult` |
| `deleteSkill` | `id` | `ChestResult` |
| `reorderSkills` | `ids` | `ChestResult` |
| `exportSkill` | `id` | `ChestExportResult` |

**每个变更方法都回传整份新列表**，所以一次动作只需一次往返，客户端不必再读一遍（也就没有"读了但已经过期"的窗口）。所有变更走同一条串行队列，写记账文件后广播 `pluginShelf/change`。

## 安装到底是哪三件事

DSH 的 profile 就是一个目录：`$DSH_HOME/profiles/<name>/`，其 `package.json` 里 `dsh.profile.bundles` 是**有序**的 bundle 层列表。装一个插件就是：

1. `dependencies[包名] = "link:<插件包绝对路径>"`（用正斜杠，跨平台可读）；
2. 把包名加进 `dsh.profile.bundles`（顺序 = 补丁层优先级）；
3. 在 `node_modules/<包名>` 建一个目录链接（Windows 用 junction，不需要管理员权限）。

卸载是逆操作；排序是把给定的一批包名放回它们**原本占用的槽位**，其它 bundle 的相对位置不动。因此 `reorderPlugins` 不只是界面顺序，而是真实的优先级变化。

依赖 `hasPatch`（即 `package.json` 的 `dsh.bundle.patch`）：没有补丁层的包不能作为 bundle 层安装，界面会把安装按钮禁用并说明原因。

## 插件包的三个名字必须一致

浏览器花名册的扫描入口是 **Loader 行名**，而行名必须等于包名，包名又必须等于预构建产物里注册的模块 id：

```
cordis.patch.yml 的 name  ＝  package.json 的 name  ＝  lib/client.js 里 __ModuleLoader__.load({ id })
```

三者任一不同，浏览器半边就会注册成孤儿模块（加载但不生效）。这是写插件时最容易踩的坑，`docs/authoring.md` 有完整例子。

## 技能为什么直接写用户根目录

DSH 的技能来自 `ctx.skills` 注册表，`dsh-skill-filesystem` 是其中一个 provider，它扫描：

- 项目根：`<project>/.dsh/skills`、`<project>/.agents/skills`
- 自定义：preset 里 `customSkillDirs` 指定的目录
- 用户：`$DSH_HOME/skills`、`~/.agents/skills`
- 随包：`$DSH_BUNDLED_SKILL_DIR`

chest 只写 `$DSH_HOME/skills`（用户根），因为那是"属于我、但不属于某个项目"的技能该待的地方，而且 standard / code 这两个 preset 默认挂 `skill-filesystem`，写进去立刻可见。技能文件格式与手写的完全一致：

```markdown
---
name: "代码评审"
description: "按清单评审一次改动"
whenToUse: "当用户要求评审代码时"
---

# 评审
1. 先看测试
2. 再看边界
```

可选 `disable-model-invocation: true` 表示"只允许人手调用"（不进入模型自动目录）。chest 的对话框里对应「仅手动调用」勾选框。

## 状态是怎么算出来的

chest 不缓存任何东西，`list()` 每次重新扫：chest 仓库 + 登记的外部目录 + 技能根目录 + profile 清单。运行状态则来自另一个既有服务 `pluginInventory`（只读投影 Loader 条目），客户端把它的 `fiberPhase === 'active'` 模块名与 chest 插件的包名对上：

| 情形 | 界面 |
| --- | --- |
| profile 里有、运行时也活着 | 绿点 · 运行中 |
| profile 里有、运行时不在 | 黄点 · 待重启生效 |
| profile 里没有 | 无点 · 未安装 |

"待重启"这个标记由 Host 记账：变更时置位，**下次启动时清除**（因为启动本身就意味着 profile 已经被 Loader 读过了）。

## 设计决策与理由

**为什么不做成纯文本指令。** 文本指令能表达"让模型做某事"，但表达不了"我这里装了什么"。用户要的是仓库与安装，不是提示词模板。

**为什么导出是单文件而不是 zip。** 分享的摩擦主要在"对方能不能直接用"。一个 JSON 文档：不用解压、不会丢目录结构、肉眼可读、导入端能严格校验。每个文件自带 `utf8`/`base64` 编码标记，二进制资源也不坏。

**为什么保留上游内部命名。** 服务名 `pluginShelf`、槽位 `sidebar.plugins`、包目录 `plugin-shelf` / `ui-plugin-shelf` 都没改名，只把用户可见的标题叫 chest。跨包的 typert 描述符、api-remotes 装配、事件白名单都按原名接线，改名要重生成一整套生成物，收益为零而风险不小。

**为什么折叠是浏览器偏好而不是服务端状态。** 它描述的是"我这台机器现在想不想看列表"，属于客户端偏好，放 `localStorage` 即可；服务端只负责它真正拥有的东西（文件与 profile）。

**为什么安装要重启。** DSH 的 Loader 在启动时组合 bundle 层，`dsh-client-modules` 的花名册扫描也是启动期一次并缓存（包括"这个包不是客户端包"的否定判定）。这是上游语义，chest 如实呈现，而不是让界面假装已经生效。

**为什么 ChestSection 用条件渲染而不是 CSS 隐藏。** 折叠时列表不进 DOM，所以 DOM 即真：可访问性树、截屏、验收脚本看到的都是真实可见内容，不会出现"看不见但能被自动化点到"的假状态。

## 与上游的关系

可以上游化的部分：`conversation.chat.turnStatusIcon` 槽位声明（空占位、无人注册时渲染为空）本身是通用扩展点，与鲸鱼无关。

属于本地 fork 期待的部分：两个 chest 包、sidebar 新增 `sidebar.plugins` 槽位、api-remotes 与 apiproxy 的类型面包、`tsconfig.base.json` 的源码路径映射，以及把鲸鱼从内置清单移到 profile 安装。
