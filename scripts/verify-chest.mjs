/**
 * Headless verification of the chest against a live dsh web server.
 *
 * Checks, in order: the section renders with its two groups, the whale plugin
 * (now an installed-by-you plugin package in the chest store) shows as not
 * installed, installing it from the dialog rewrites the profile, and a skill
 * authored in the dialog becomes a real SKILL.md that the skill provider will
 * find. Screenshots land beside this script.
 *
 * Usage: node verify-chest.mjs [port]
 */
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
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
mkdirSync(shots, { recursive: true })

const errors = []
const report = { url, steps: [] }
const step = (name, value) => {
  report.steps.push({ name, value })
  console.log(`- ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message.slice(0, 300)}`) })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(14000)

  const sidebar = page.locator('[class*="sidebar"]').first()
  await sidebar.screenshot({ path: `${shots}/sidebar-before.png` })

  // 1. the section and its two groups
  const bodyText = await page.evaluate(() => document.body.innerText)
  step('section title present', bodyText.includes('chest'))
  step('plugin group present', /\bplugin\b/.test(bodyText))
  step('skill group present', /\bskill\b/.test(bodyText))
  step('old title gone', !bodyText.includes('暂无插件') && !bodyText.includes('指令文本'))

  // 2. the whale is a chest plugin now, not installed
  const whaleRow = page.getByTitle('dsh-whale-diving')
  step('whale row count', await whaleRow.count())
  step('whale row text', (await whaleRow.first().innerText().catch(() => '(none)')).replace(/\n/g, ' | '))

  // 3. install it from the dialog
  if (await whaleRow.count() > 0) {
    await whaleRow.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await page.screenshot({ path: `${shots}/whale-dialog.png` })
    step('dialog text', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
    const install = dialog.getByRole('button', { name: '安装' })
    step('install button count', await install.count())
    if (await install.count() > 0) {
      await install.first().click()
      await page.waitForTimeout(2500)
      step('dialog after install', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
      await page.screenshot({ path: `${shots}/whale-installed.png` })
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }

  // 4. author a skill in the dialog
  const skillAdd = page.getByRole('button', { name: '新建 skill' })
  step('skill add button count', await skillAdd.count())
  if (await skillAdd.count() > 0) {
    await skillAdd.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    const inputs = dialog.locator('input[type="text"], input:not([type])')
    await inputs.nth(0).fill('chest 自检技能')
    await inputs.nth(1).fill('验证 chest 能否写出真实的 SKILL.md')
    await inputs.nth(2).fill('当需要确认 chest 的 skill 功能时')
    await dialog.locator('textarea').first().fill('# 自检\n\n1. 确认文件落盘\n2. 确认能被技能目录发现\n')
    await page.screenshot({ path: `${shots}/skill-dialog.png` })
    const save = dialog.getByRole('button', { name: '保存' })
    await save.first().click()
    await page.waitForTimeout(2500)
    step('dialog closed after save', !(await dialog.isVisible().catch(() => false)))
  }
  const skillFile = `${home}/.dsh/skills/chest-自检技能/SKILL.md`
  step('skill file written', existsSync(skillFile))
  if (existsSync(skillFile)) {
    step('skill file head', readFileSync(skillFile, 'utf8').split('\n').slice(0, 6).join(' | '))
  }

  // 5. export the skill and keep the download
  const skillRow = page.getByTitle(skillFile.replace(/\//g, '\\'))
  if (await skillRow.count() > 0) {
    await skillRow.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    await dialog.getByRole('button', { name: '导出' }).first().click()
    const download = await downloadPromise
    if (download !== null) {
      const target = `${shots}/${download.suggestedFilename()}`
      await download.saveAs(target)
      step('exported file', `${download.suggestedFilename()} (${readFileSync(target, 'utf8').length} bytes)`)
      const bundle = JSON.parse(readFileSync(target, 'utf8'))
      step('bundle shape', { format: bundle.format, revision: bundle.revision, kind: bundle.kind, files: bundle.files.map(f => f.path) })
    } else {
      step('exported file', 'NO DOWNLOAD EVENT')
    }
    await page.keyboard.press('Escape')
  }

  await sidebar.screenshot({ path: `${shots}/sidebar-after.png` })
  step('console errors', errors.length === 0 ? '(none)' : errors)
  report.ok = errors.length === 0
} finally {
  await browser.close()
}
console.log('\n=== report ===')
console.log(JSON.stringify(report, null, 2))
