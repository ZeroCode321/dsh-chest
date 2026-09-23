/**
 * Third verification pass: the plugin export path, the ordering actions, and a
 * clean exit that removes the two test skills so the user's skill root is left
 * as it was found.
 *
 * Usage: node verify-chest3.mjs [port]
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// The checkout that holds a Playwright install; override with DSH_CHECKOUT.
const checkout = (process.env.DSH_CHECKOUT ?? 'C:/deepseek-harness').replace(/\\/g, '/')
const { chromium } = require(`${checkout}/apps/web/node_modules/playwright/index.js`)

const port = process.argv[2] ?? '3082'
const home = (process.env.DSH_HOME ?? `${homedir()}/.dsh`).replace(/\\/g, '/')
const url = `http://127.0.0.1:${port}`
// Where screenshots and exported bundles land; override with CHEST_SHOTS.
const shots = fileURLToPath(new URL('../.shots/', import.meta.url))
const skillsRoot = `${home}/.dsh/skills`
const chestState = `${home}/.dsh/chest/chest.json`
mkdirSync(shots, { recursive: true })

const errors = []
const steps = []
const step = (name, value) => {
  steps.push({ name, value })
  console.log(`- ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)) })
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message.slice(0, 300)}`) })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(14000)

  // 1. export the whale plugin package as one shareable file
  const whaleRow = page.getByTitle('dsh-whale-diving')
  await whaleRow.first().click()
  const pluginDialog = page.getByRole('dialog')
  await pluginDialog.waitFor({ state: 'visible', timeout: 5000 })
  const waiting = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
  await pluginDialog.getByRole('button', { name: '导出' }).first().click()
  const download = await waiting
  if (download !== null) {
    const target = `${shots}/${download.suggestedFilename()}`
    await download.saveAs(target)
    const bundle = JSON.parse(readFileSync(target, 'utf8'))
    step('plugin export', {
      file: download.suggestedFilename(),
      kind: bundle.kind,
      bytes: readFileSync(target, 'utf8').length,
      files: bundle.files.map(f => f.path),
    })
  } else {
    step('plugin export', 'NO DOWNLOAD EVENT')
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // 2. a second skill, so ordering has something to move
  await page.getByRole('button', { name: '新建 skill' }).first().click()
  const skillDialog = page.getByRole('dialog')
  await skillDialog.waitFor({ state: 'visible', timeout: 5000 })
  const inputs = skillDialog.locator('input[type="text"], input:not([type])')
  await inputs.nth(0).fill('aaa 排序测试')
  await inputs.nth(1).fill('用于验证排序动作')
  await skillDialog.locator('textarea').first().fill('# 排序测试\n')
  await skillDialog.getByRole('button', { name: '保存' }).first().click()
  await page.waitForTimeout(2500)

  const skillRowButtons = page.locator('button[title$="SKILL.md"]')
  const orderBefore = await skillRowButtons.evaluateAll(nodes => nodes.map(node => node.innerText.split('\n')[0]))
  step('skill order before move', orderBefore)

  // 3. move the new skill up one slot
  const newSkillRow = page.getByTitle(`${skillsRoot.replace(/\//g, '\\')}\\aaa-排序测试\\SKILL.md`)
  step('new skill row count', await newSkillRow.count())
  await newSkillRow.first().click()
  const editDialog = page.getByRole('dialog')
  await editDialog.waitFor({ state: 'visible', timeout: 5000 })
  await editDialog.getByRole('button', { name: '上移' }).first().click()
  await page.waitForTimeout(2500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  const orderAfter = await skillRowButtons.evaluateAll(nodes => nodes.map(node => node.innerText.split('\n')[0]))
  step('skill order after move', orderAfter)
  step('persisted skill order', JSON.parse(readFileSync(chestState, 'utf8')).skillOrder)
  const sidebar = page.locator('[class*="sidebar"]').first()
  await sidebar.screenshot({ path: `${shots}/sidebar-order.png` })

  // 4. clean exit: remove both test skills through the chest
  for (const slug of ['aaa-排序测试', 'chest-自检技能']) {
    const row = page.getByTitle(`${skillsRoot.replace(/\//g, '\\')}\\${slug}\\SKILL.md`)
    if (await row.count() === 0) continue
    await row.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await dialog.getByRole('button', { name: '删除' }).first().click()
    await page.waitForTimeout(300)
    await dialog.getByRole('button', { name: '确认删除' }).first().click()
    await page.waitForTimeout(2200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    step(`skill removed: ${slug}`, !existsSync(`${skillsRoot}/${slug}/SKILL.md`))
  }
  step('skill root left with', existsSync(skillsRoot) ? readdirSync(skillsRoot) : '(absent)')
  step('console errors', errors.length === 0 ? '(none)' : errors)
} finally {
  await browser.close()
}
console.log('\n=== report ===')
console.log(JSON.stringify({ ok: errors.length === 0, steps }, null, 2))
