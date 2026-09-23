/**
 * dsh-whale-diving —— 宿主半边：一个空实现。
 *
 * 这个插件的全部能力都在浏览器半边（lib/client.js）：它把一只下潜的鲸鱼注册到
 * 对话流运行中回合状态的图标位 `conversation.chat.turnStatusIcon`（由
 * @deepseek-ai/dsh-client-ui-conversation 声明，无人注册时该位置渲染为空）。
 *
 * 宿主半边之所以存在，是因为 Loader 必须能 import 本行：cordis.patch.yml 插入的
 * 那一行 name 是 `dsh-whale-diving`，Loader 解析它拿到本文件；而浏览器花名册的扫描
 * 以「已启用的 loader 行名」为入口，用同一个包名读 package.json 的 dsh.client，
 * 找到并伺服 lib/client.js。两半共用一个包名，所以行名不能改。
 */

/** Cordis 插件名。 */
export const name = 'whale-diving'

/** 宿主侧无行为：这只鲸鱼只在浏览器里游。 */
export function apply() {}
