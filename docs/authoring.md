# 插件与技能编写

面向想给 DSH 写插件、或想把技能规范化的人。全部结论都来自 chest 实际使用与验证过的路径。

## 一、插件包：四个文件起步

一个可被 chest 管理、能被 DSH 真正加载的插件包最小形态：

```
dsh-my-plugin/
  package.json          清单：名字、入口、dsh.bundle / dsh.client 声明
  cordis.patch.yml      补丁层：往 Loader 里插入一行
  index.js              host 半边（可以是空实现）
  lib/client.js         浏览器半边（可选，预构建的经典脚本）
```

### package.json

```json
{
  "name": "dsh-my-plugin",
  "version": "0.1.0",
  "description": "一句话说明它做什么",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": { "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-slots"
      ]
    }
  },
  "files": ["index.js", "lib/client.js", "cordis.patch.yml", "README.md"],
  "license": "MIT"
}
```

要点：

- `dsh.bundle.patch` 是**成为 bundle 层的必要条件**：profile 加载一个 bundle 时若拿不到补丁文件会直接报错。没有它，chest 会禁用「安装」并说明原因。
- `dsh.client.platform` 必须是 `"web"`；`exports["./client"]` 必须是字符串或 `{ default: ... }`。二者缺一，浏览器花名册会拒绝该包。
- `dsh.client.inject` 声明这个浏览器模块依赖哪些客户端模块（加载顺序与预取用）。它不会自动推导，写漏了就会出现"有时先于依赖加载"的偶发问题。

### cordis.patch.yml

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
```

`name` 是 Loader 要解析的模块说明符，必须与包名一致。

### index.js（host 半边）

```js
export const name = 'my-plugin'

/** 宿主侧无行为，或在这里注册服务/工具/提示词段落。 */
export function apply() {}
```

纯界面插件也必须有 host 半边：Loader 要能 import 这一行，否则整个补丁层加载失败。

### lib/client.js（浏览器半边）

这是**预构建的经典脚本**（不是 ESM），自己向 shell 注册：

```js
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin',
  factory: (require) => {
    const react = require('react')
    function apply(ctx) {
      ctx.slots.inject('conversation.chat.turnStatusIcon', () => ctx.slots.register(
        { name: 'conversation.chat.turnStatusIcon' },
        MyIcon,
      ))
    }
    return { apply }
  },
})
```

`require` 由 shell 提供（`react`、`react/jsx-runtime`、其它客户端模块 id 都可要求）；`id` 必须等于包名。

### 三条硬规则

1. `cordis.patch.yml` 的行名 = `package.json` 的 `name` = `lib/client.js` 注册的 `id`。
2. host 半边必须能被 import 成功（哪怕是空 `apply`）。
3. `lib/client.js` 必须在**服务器启动前**就存在——花名册扫描时"声明了 `dsh.client` 但文件缺失"会让整个启动抛错。

参考实现：`plugins/dsh-whale-diving/`（完整可用的例子，含源码与预构建产物）。

## 二、从源码构建浏览器半边

DSH monorepo 里客户端包用 `tsdown` + 一个共享预设构建：

```ts
// packages/client/<你的包>/tsdown.config.ts
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@scope/你的包名', ['lib/types/index.js', 'lib/types/invariant.js'])
```

然后 `npm run build:lib:client`。产物 `lib/client.js` 就是上面说的经典脚本（自动包好 CSS Module、注入 `<style data-plugin-css>`）。

**不在 monorepo 里的插件**（像 `plugins/dsh-whale-diving/`）没有这套工具链，做法是：在 monorepo 里构建一次，把 `lib/client.js` 拷进插件包，并把它注册的 `id` 改成插件包名。改动源码后重复这一步即可。

## 三、调试插件

| 现象 | 原因与处理 |
| --- | --- |
| 装完没反应 | 十有八九没重启 `dsh web`（chest 会显示「待重启生效」） |
| 浏览器半边不生效 | 三个名字不一致（行名/包名/注册 id），或 `exports["./client"]` 写错 |
| 服务器启动直接报错 | 声明了 `dsh.client` 但 `lib/client.js` 不存在，或缺 `dsh.bundle.patch` |
| 想确认模块真的跑了 | 在浏览器控制台执行：`document.querySelector('style[data-plugin-css^="<包名>"]') !== null`（若插件注入了 CSS）；或看 `window.__DSH_BOOT__` 里有无该行（只说明被扫描，不等于执行） |
| 想确认行是活的 | chest 插件行显示「运行中」即 `pluginInventory` 报告该模块 `fiberPhase === 'active'` |

## 四、技能：一个文件就够

目录包（可带资源）与平铺单文件两种都可以：

```
~/.dsh/skills/release-check/SKILL.md      目录包：可放脚本、模板、图片
~/.dsh/skills/quick-note.md               平铺：一个文件
```

frontmatter 字段：

| 字段 | 必填 | 作用 |
| --- | --- | --- |
| `name` | 是 | 调用名：`/名字` 与模型自动目录里显示的名字 |
| `description` | 是 | 一句话说明；目录里显示它，模型据此判断是否加载 |
| `whenToUse` | 否 | 什么时候该用它，给模型的补充线索 |
| `disable-model-invocation` | 否 | `true` 表示只允许人手调用，不进模型自动目录 |

chest 的对话式编辑器写出的就是这套格式；改名字只改 frontmatter 的 `name`（= 调用名），目录 slug 保持创建时的值。

**怎么分享技能**：在 chest 里点导出，得到 `<id>.chest`；对方在自己的 chest 里「新建 skill」→「导入 .chest 文件」即可，正文与附带资源一起过去。

## 五、把已有的插件放进 chest

如果你已经手工装过一个插件（例如自己 `link:` 进 profile 的目录），它在 chest 里默认不出现——chest 只列它自己管的（仓库里的 + 登记过的）。一次操作即可纳管：

1. `plugin` 分区点 `+` → 粘贴该插件的绝对目录 → 添加目录；
2. 该行会立刻显示「已安装 · 运行中」（因为 profile 里已经有它）；
3. 之后排序、导出、卸载、删除都可以在 chest 里做。外部登记的插件删除时只移除登记，磁盘上的文件不动。
