/**
 * Final runtime pass against a freshly booted server: the chest renders and
 * folds, the whale plugin is live AND its browser module actually instantiated
 * (its CSS tag is the module's own footprint), and nothing logs an error.
 *
 * Usage: node verify-runtime.mjs [port]
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
const url = `http://127.0.0.1:${port}`
// Where screenshots and exported bundles land; override with CHEST_SHOTS.
const shots = fileURLToPath(new URL('../.shots/', import.meta.url))
mkdirSync(shots, { recursive: true })

const errors = []
const steps = []
const step = (name, value) => { steps.push({ name, value }); console.log(`- ${name}: ${JSON.stringify(value)}`) }

const html = await (await fetch(url)).text()
const bootIds = [...html.matchAll(/"id":"([^"]+)"/g)].map(m => m[1])
step('boot entries', bootIds.length)
step('whale in roster', bootIds.includes('dsh-whale-diving'))
step('chest client in roster', bootIds.includes('@deepseek-ai/dsh-client-ui-plugin-shelf'))

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)) })
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message.slice(0, 300)}`) })
  page.on('requestfailed', (req) => { errors.push(`requestfailed: ${req.url().slice(0, 160)}`) })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(15000)

  // the whale's own module ran: it injects its CSS under its own id
  step('whale module instantiated', await page.evaluate(() =>
    document.querySelector('style[data-plugin-css^="dsh-whale-diving"]') !== null))
  step('chest style present', await page.evaluate(() =>
    [...document.styleSheets].some(sheet => (sheet.ownerNode?.textContent ?? '').includes('headerToggle'))))

  const toggle = page.getByRole('button', { name: /chest/ }).first()
  step('folded at first paint', await toggle.getAttribute('aria-expanded'))
  await toggle.click()
  await page.waitForTimeout(800)
  step('opens on click', await toggle.getAttribute('aria-expanded'))
  step('whale row state', (await page.getByTitle('dsh-whale-diving').first().innerText()).replace(/\n/g, ' | '))
  step('skill group offered', await page.getByRole('button', { name: '新建 skill' }).count())
  await page.locator('[class*="sidebar"]').first().screenshot({ path: `${shots}/runtime-final.png` })

  // every remote call the chest makes must have answered: re-list once more
  await page.getByRole('button', { name: '刷新' }).first().click()
  await page.waitForTimeout(2000)
  step('errors after refresh', errors.length)

  step('console errors', errors.length === 0 ? '(none)' : errors)
} finally {
  await browser.close()
}
console.log('\n=== report ===')
console.log(JSON.stringify({ ok: errors.length === 0, steps }, null, 2))
