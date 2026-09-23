/**
 * Second verification pass for the chest, against a restarted server:
 * the installed whale must now be live, and a skill must survive an
 * export -> delete -> import round trip through a `.chest` file.
 *
 * Usage: node verify-chest2.mjs [port] [skillName]
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// The checkout that holds a Playwright install; override with DSH_CHECKOUT.
const checkout = (process.env.DSH_CHECKOUT ?? 'C:/deepseek-harness').replace(/\\/g, '/')
const { chromium } = require(`${checkout}/apps/web/node_modules/playwright/index.js`)

const port = process.argv[2] ?? '3082'
const home = (process.env.DSH_HOME ?? `${homedir()}/.dsh`).replace(/\\/g, '/')
const skillName = process.argv[3] ?? 'chest 自检技能'
const slug = process.argv[4] ?? 'chest-自检技能'
const url = `http://127.0.0.1:${port}`
// Where screenshots and exported bundles land; override with CHEST_SHOTS.
const shots = fileURLToPath(new URL('../.shots/', import.meta.url))
const skillFile = `${home}/.dsh/skills/${slug}/SKILL.md`
mkdirSync(shots, { recursive: true })

const errors = []
const steps = []
const step = (name, value) => {
  steps.push({ name, value })
  console.log(`- ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

// 1. the boot roster must carry the chest-installed plugin now
const html = await (await fetch(url)).text()
const bootIds = [...html.matchAll(/"id":"([^"]+)"/g)].map(m => m[1])
step('boot roster has whale', bootIds.includes('dsh-whale-diving'))
step('boot roster has chest client', bootIds.includes('@deepseek-ai/dsh-client-ui-plugin-shelf'))

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

  // 2. the installed plugin now reports running, not pending restart
  const whaleRow = page.getByTitle('dsh-whale-diving')
  step('whale row text', (await whaleRow.first().innerText().catch(() => '(none)')).replace(/\n/g, ' | '))
  const sidebar = page.locator('[class*="sidebar"]').first()
  await sidebar.screenshot({ path: `${shots}/sidebar-live.png` })

  // 3. export the chest-authored skill (the row's title is the real, backslashed path)
  const skillRow = page.getByTitle(skillFile.replace(/\//g, '\\'))
  step('skill row count', await skillRow.count())
  let exported = null
  if (await skillRow.count() > 0) {
    await skillRow.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    const waiting = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
    await dialog.getByRole('button', { name: '导出' }).first().click()
    const download = await waiting
    if (download !== null) {
      exported = `${shots}/${download.suggestedFilename()}`
      await download.saveAs(exported)
      const bundle = JSON.parse(readFileSync(exported, 'utf8'))
      step('exported bundle', { file: download.suggestedFilename(), kind: bundle.kind, files: bundle.files.map(f => f.path), bytes: readFileSync(exported, 'utf8').length })
    } else {
      step('exported bundle', 'NO DOWNLOAD EVENT')
    }

    // 4. delete it, two-step confirm
    await dialog.getByRole('button', { name: '删除' }).first().click()
    await page.waitForTimeout(300)
    await dialog.getByRole('button', { name: '确认删除' }).first().click()
    await page.waitForTimeout(2500)
    step('skill file after delete', existsSync(skillFile))
  }

  // 5. import the exported file back through the hidden file input
  if (exported !== null) {
    const skillAdd = page.getByRole('button', { name: '新建 skill' })
    await skillAdd.first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await dialog.locator('input[type="file"]').setInputFiles(exported)
    await page.waitForTimeout(3000)
    step('skill file after import', existsSync(skillFile))
    if (existsSync(skillFile)) {
      step('imported body kept', readFileSync(skillFile, 'utf8').includes('确认能被技能目录发现'))
    }
    await page.screenshot({ path: `${shots}/after-import.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }

  // 6. best effort: a chest skill must be a real skill, so '/' offers it
  const composer = page.locator('textarea, [contenteditable="true"]').last()
  if (await composer.count() > 0) {
    await composer.click()
    await page.keyboard.type('/chest')
    await page.waitForTimeout(1800)
    const menuText = await page.evaluate(() => document.body.innerText)
    step('slash menu offers the skill', menuText.includes(skillName))
    await page.screenshot({ path: `${shots}/slash-menu.png` })
    await page.keyboard.press('Escape')
  } else {
    step('slash menu offers the skill', 'no composer found')
  }

  step('console errors', errors.length === 0 ? '(none)' : errors)
  await sidebar.screenshot({ path: `${shots}/sidebar-final.png` })
} finally {
  await browser.close()
}
console.log('\n=== report ===')
console.log(JSON.stringify({ ok: errors.length === 0, steps }, null, 2))
