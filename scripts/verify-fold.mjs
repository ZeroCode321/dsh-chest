/**
 * Fold verification: the chest must open on a click of its header, stay folded
 * otherwise, and remember the fold across a reload.
 *
 * Usage: node verify-fold.mjs [port]
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// The checkout that holds a Playwright install; override with DSH_CHECKOUT.
const checkout = (process.env.DSH_CHECKOUT ?? 'C:/deepseek-harness').replace(/\\/g, '/')
const { chromium } = require(`${checkout}/apps/web/node_modules/playwright/index.js`)

const port = process.argv[2] ?? '3082'
const home = (process.env.DSH_HOME ?? `${homedir()}/.dsh`).replace(/\\/g, '/')
// Where screenshots and exported bundles land; override with CHEST_SHOTS.
const shots = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(shots, { recursive: true })

const errors = []
const steps = []
const step = (name, value) => { steps.push({ name, value }); console.log(`- ${name}: ${JSON.stringify(value)}`) }

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)) })
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message.slice(0, 300)}`) })

  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(14000)
  const sidebar = page.locator('[class*="sidebar"]').first()

  // 1. a fresh browser starts folded: the header is there, the rows are not
  const toggle = page.getByRole('button', { name: /chest/ }).first()
  step('header aria-expanded (fresh)', await toggle.getAttribute('aria-expanded'))
  step('rows while folded', { plugin: await page.getByTitle('dsh-whale-diving').count(), skillAdd: await page.getByRole('button', { name: '新建 skill' }).count() })
  const foldedText = await page.evaluate(() => document.body.innerText)
  step('folded body has no group labels', [/\bplugin\b/.test(foldedText), /\bskill\b/.test(foldedText)])
  step('localStorage before any click', await page.evaluate(() => localStorage.getItem('dsh.chest.expanded')))
  await sidebar.screenshot({ path: `${shots}/fold-folded.png` })

  // 2. one click opens both groups
  await toggle.click()
  await page.waitForTimeout(900)
  step('header aria-expanded (opened)', await toggle.getAttribute('aria-expanded'))
  step('rows after opening', { plugin: await page.getByTitle('dsh-whale-diving').count(), skillAdd: await page.getByRole('button', { name: '新建 skill' }).count() })
  step('localStorage after opening', await page.evaluate(() => localStorage.getItem('dsh.chest.expanded')))
  await sidebar.screenshot({ path: `${shots}/fold-open.png` })

  // 3. the fold survives a reload
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(14000)
  step('rows after reload', await page.getByTitle('dsh-whale-diving').count())
  await sidebar.screenshot({ path: `${shots}/fold-open-after-reload.png` })

  // 4. and it closes again
  const toggleAgain = page.getByRole('button', { name: /chest/ }).first()
  await toggleAgain.click()
  await page.waitForTimeout(900)
  step('rows after closing', await page.getByTitle('dsh-whale-diving').count())
  step('localStorage after closing', await page.evaluate(() => localStorage.getItem('dsh.chest.expanded')))
  await sidebar.screenshot({ path: `${shots}/fold-closed-again.png` })

  step('console errors', errors.length === 0 ? '(none)' : errors)
} finally {
  await browser.close()
}
console.log('\n=== report ===')
console.log(JSON.stringify({ ok: errors.length === 0, steps }, null, 2))
