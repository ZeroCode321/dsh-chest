# 验证报告

本文件记录 chest 交付前的全部检查、原始命令与实测证据。所有结论都可以按[复现步骤](#复现步骤)重跑一遍。

- 环境：Windows 11 · Node 22 · pnpm 工作区 · DSH 源码 checkout（浅克隆，`master` 位于 `47f9438`）
- 验证方式：先跑单元测试与仓库门检，再起**第二个 `dsh web` 实例（端口 3082）**用 Playwright + Edge 做无头端到端验收——之所以另起实例，是因为改动包含 Host 侧代码与浏览器花名册，只有重新启动的进程才会加载新代码。

## 1. 单元测试

```
npx vitest run packages/host/plugin-shelf packages/client/ui-plugin-shelf packages/client/ui-sidebar packages/api/remotes
```

| 测试文件 | 数量 | 结果 |
| --- | --- | --- |
| `packages/host/plugin-shelf/tests/plugin-shelf.spec.ts` | 7 | 通过 |
| `packages/client/ui-plugin-shelf/tests/chest.client.spec.ts` | 5 | 通过 |
| `packages/client/ui-sidebar/tests/*`（受影响的下游） | 21 | 通过 |
| `packages/api/remotes/tests/*` | 6 | 通过 |
| 合计 | 39 | 全部通过 |

Host 单测覆盖的行为（每条都对应一个真实的失败模式）：

- Remote 方法名集与 Typert 命名空间；
- 空 chest + 读到的 profile；
- 技能写入/改写/删除：`SKILL.md` 的 frontmatter 与正文、重复 slug 拒绝、顺序持久化；
- 插件登记（就地）→ 安装 → profile 三处改动（依赖、bundle 项、目录链接）→ 卸载复原；
- `.chest` 往返：导出含 `package.json` / `cordis.patch.yml` / `lib/client.js`，导入到仓库形成副本，**路径穿越（`../escape.js`）被拒绝**；
- 排序：chest 顺序与 profile 的 bundle 槽位同时变化；不合法的列表被拒绝；
- 变更事件 `pluginShelf/change`。

客户端单测覆盖：折叠偏好默认收好、写入/回读 `localStorage` 的 `dsh.chest.expanded`；两份文案都不含 emoji；中英键集一致。

## 2. 仓库门检

| 门检 | 命令 | 结果 |
| --- | --- | --- |
| 导出 JSDoc 完整性 | `npx tsx scripts/verify-export-jsdoc.ts` | 通过（修复前 42 处缺失） |
| 包不变量 | `npx tsx scripts/verify-package-invariants.ts` | 通过（221 个包） |
| 构建产物不变量 | `node scripts/verify-built-package-invariants.mjs` | 通过（221 个包，纯 Node Loader 校验） |
| Cordis 配置校验 | `npx tsx scripts/verify-cordis-config.ts` | 通过（修复前报两个新包缺源码路径映射） |
| 未用代码/依赖 | `npx knip --treat-config-hints-as-errors` | 通过（修复前报 `zod` 未用与测试目录缺文件） |
| README · Model Experience | `npx tsx scripts/verify-package-readme-model-experience.ts` | 通过（221 份，含本仓库两个结构化条目） |
| README · Limitations | `npx tsx scripts/verify-package-readme-limitations.ts` | 通过 |
| 配置来源归属 | `npx tsx scripts/verify-config-source-ownership.ts` | 通过 |
| Lint（类型感知） | `npx tsx scripts/run-oxlint.ts packages/host/plugin-shelf packages/client/ui-plugin-shelf` | 0 警告 0 错误 |
| 客户端域图谱 | `npx tsx scripts/verify-client-domain-graph.ts` | **27 处违规，全部与本改动无关**（见下） |

关于域图谱：违规全部落在 `runtime/src/client/contract/**`、`ui-conversation/src/client/skeleton/**`、`ui-input-trigger/src/client/**`、`ui-workspace/src/client/**`——这些目录在本交付中**未被触碰**（`git status` 为空），清单里也没有 `ui-plugin-shelf`。这是 checkout 既存状态，不作为本仓库的通过项。

## 3. 端到端实测

### 3.1 界面与折叠

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 首次打开 | 收好，只有一行 `chest <数量>` | `aria-expanded="false"`，插件行数 0，`localStorage` 为空 |
| 点标题 | 展开两个分区 | `aria-expanded="true"`，插件行 1 个、「新建 skill」按钮出现，`localStorage` 变 `true` |
| 刷新页面 | 保持展开 | 插件行仍为 1 |
| 再点标题 | 收起 | 插件行 0，`localStorage` 变 `false` |
| 全程控制台 | 无错误 | 0 报错、0 失败请求 |

截图：[收好](screenshots/chest-folded.png) · [展开](screenshots/chest-open.png) · [刷新后仍展开](screenshots/chest-open-after-reload.png)

### 3.2 插件：安装、生效、排序、导出

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 仓库里的插件被列出 | 显示「chest 仓库 · 未安装」 | 一致（`dsh-whale-diving`） |
| 对话框点安装 | profile 被改写 | `dependencies` 出现 `link:C:/Users/…/.dsh/chest/plugins/dsh-whale-diving`；`dsh.profile.bundles` 追加 `dsh-whale-diving`；`node_modules/dsh-whale-diving` 是目录链接 |
| 安装后界面 | 「已安装 · 待重启生效」 | 一致，按钮翻转为「卸载」 |
| 重启后 | 插件真正加载 | `window.__DSH_BOOT__` 含 `dsh-whale-diving`；`/plugins/dsh-whale-diving/client.js` 返回 200 且内容为改写后的 7133 字节；行显示「运行中」 |
| 模块真的执行了 | 浏览器模块注入自己的 CSS | `document.querySelector('style[data-plugin-css^="dsh-whale-diving"]') !== null` 为真 |
| 排序 | 界面顺序与落盘顺序一致 | 上移后界面顺序为 `["aaa 排序测试","chest 自检技能"]`，`chest.json` 的 `skillOrder` 同步为 `["aaa-排序测试","chest-自检技能"]` |
| 导出插件 | 一个 `.chest` 文件 | 19 KB，10 个文件（含 `package.json`、`cordis.patch.yml`、`lib/client.js`、`src/**`、`README.md`） |
| 删除外部插件 | 只取消登记，磁盘文件保留 | 一致 |

截图：[插件对话框](screenshots/plugin-dialog.png) · [排序](screenshots/skill-ordering.png) · [生效后](screenshots/chest-live.png)

### 3.3 技能：真技能闭环与分享往返

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 界面新建技能 | 写出真实 `SKILL.md` | `~/.dsh/skills/chest-自检技能/SKILL.md` 内容含 frontmatter（`name`/`description`/`whenToUse`）与正文 |
| 它是真技能 | `/` 菜单能列出 | 输入 `/chest` 后菜单出现「chest 自检技能」 |
| 导出 | 一个 `.chest`（技能） | `chest-自检技能.chest`，440 字节，`files: ["SKILL.md"]` |
| 删除 → 再导入 | 正文完好复原 | 删除后文件不存在；导入后文件恢复且正文含原句 |
| 清理 | 不留测试残留 | 两个测试技能删除后，`~/.dsh/skills` 为空，`chest.json` 顺序为空 |

截图：[技能编辑器](screenshots/skill-editor.png) · [`/` 菜单里的技能](screenshots/skill-in-slash-menu.png) · [导入结果](screenshots/import-result.png)

## 4. 本轮修复的真实缺陷

验证过程中发现并修复的问题（都不是"为了过门检"，而是真实运行问题）：

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| 插件扫描结果没带上"是否已安装" | 卸载、排序变成静默无效（点卸载显示成功但 profile 没变） | 扫描时合并 profile 的 bundle 列表；单测锁定该行为 |
| `zod` 依赖在源码里没有任何引用 | knip 报未用依赖；但它其实是生成的 Typert 描述符运行时 `import` 的包 | 采用上游 `dsh-host-plugin-inventory` 的写法，加一行 `import type {} from 'zod'` 并注明原因 |
| 折叠区最初不存在 | 侧边栏被列表长期占用 | 改为可折叠，默认收好，状态持久化 |
| 列表首尾仍可点"上移/下移" | 无效动作会弹出"已保存"，等于撒谎 | 到边界时禁用按钮 |
| 生成的 `package.json` 带 UTF-8 BOM | 构建工具 `JSON.parse` 直接失败（Windows PowerShell 写文件的默认行为） | 全部改写为无 BOM 的 UTF-8 |
| 42 处导出缺 `@param`/`@returns` | 违反仓库文档契约，门检失败 | 逐条补齐，含 13 个 Remote 方法 |

## 5. 未能验证的部分（如实说明）

- **用户当前运行的实例（3080）未重启验证**：这个实例承载着交互会话本身，重启会中断它。验证是在同构的第二个实例（3082）上完成的；应用到 3080 只需重启。
- **动画本身**：验证到"模块已执行 + 槽位已注册 + 无控制台错误"，但没有在真实回合运行中截图鲸鱼动画（那需要真实发起一次模型请求）。
- **海外/多语言界面**：只验证了中文界面；英文文案与中文键集一致（单测覆盖），但未在英文界面下点过一遍。
- **打包体积/性能**：chest 客户端产物约 49 KB（未压缩），列表渲染未做大数量（百级以上条目）压测。

## 复现步骤

```powershell
# 1. 应用补丁并构建
git -C <checkout> checkout -b chest
git -C <checkout> am <repo>\patches\*.patch
cd <checkout>; npm run build:lib:host; npm run build:lib:client

# 2. 起一个验证实例（不动你正在用的那个）
node --import tsx/esm apps/cli/src/bin.ts web --port 3082

# 3. 无头验收（需要 Edge 与 checkout 里的 playwright）
cd <repo>\scripts
node verify-chest.mjs 3082      # 分区渲染、安装、建技能
node verify-chest2.mjs 3082     # 鲸鱼是否生效、导出→删除→导入
node verify-chest3.mjs 3082     # 插件导出、排序落盘、清理
node verify-fold.mjs 3082       # 折叠：默认收好、点开、刷新后保持
node verify-runtime.mjs 3082    # 只读终检：banner、模块实例化、零错误
```
