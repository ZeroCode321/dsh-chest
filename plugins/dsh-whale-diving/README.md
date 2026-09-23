# dsh-whale-diving

一只下潜的鲸鱼：它出现在对话流「运行中」那条回合状态旁边，跟着回合一起呼吸。
纯装饰，零业务面：不注册工具、不写提示词段落、不改任何请求内容。

## 它挂在哪里

`conversation.chat.turnStatusIcon`，由 `@deepseek-ai/dsh-client-ui-conversation`
声明的单占位（single）槽位，会话作用域。没人注册时那个位置渲染为空，所以这个插件
是纯增量的：装上就多一只鲸鱼，卸掉就恢复纯文字状态行。

## 两半为什么长这样

| 半边 | 文件 | 作用 |
| ---- | ---- | ---- |
| host | `index.js` | 空实现。存在的唯一理由是 `cordis.patch.yml` 插入的那一行必须能被 Loader import 成功 |
| browser | `lib/client.js` | 预构建的经典脚本，自己调用 `window.__ModuleLoader__.load({ id, factory })` 注册 |

两半共用同一个包名，而且这个包名 = patch 里那一行的 `name` = 浏览器模块注册的 `id`。
改包名必须同时改这三处，否则浏览器半边会注册成孤儿模块。

## 安装

由 **chest** 管理：侧边栏 chest 的 plugin 分区里点 install，就是把本目录
`link:` 进当前 profile 的依赖、把包名加进 `dsh.profile.bundles`、并在 profile 的
`node_modules` 里建一个目录链接。三件事做完需要重启 `dsh web` 才生效——Loader 在启动时
把 bundle 层组合好，浏览器花名册也只在启动时扫一次。

## 修改与重新构建

`src/` 是原始 TSX 源码，留在这里便于阅读和修改；`lib/client.js` 是构建产物。
本目录不在 dsh 源码工作区里，所以没有随手的构建命令。要改动画：

1. 把 `src/` 里的文件放回 dsh 源码树（`packages/client/<名字>/src/`），补一个使用
   `clientBundle('<包名>', [...])` 的 `tsdown.config.ts`；
2. 在源码树里跑 `npm run build:lib:client`；
3. 把生成的 `lib/client.js` 拷回来，并把其中注册的 `id` 改成 `dsh-whale-diving`。

`lib/client.js` 里的 `id` 与 CSS 去重键都已经被改成本包名，直接编辑源码时注意别把它们改回去。
