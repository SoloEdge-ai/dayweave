import assert from 'node:assert/strict'
import { devices } from 'playwright'
import { call } from './session.mjs'

const grip = (page, name) => page.getByRole('separator', { name: '调整宽度 · ' + name, exact: true })
const size = async handle => Number(await handle.getAttribute('aria-valuenow'))
async function rendered(page, handle, expected) {
  const id = await handle.getAttribute('aria-controls')
  await page.waitForFunction(({ id, expected }) => Math.abs(document.getElementById(id).getBoundingClientRect().width - expected) < 2,
    { id, expected })
}

export async function checkDesktopLayout(page) {
  const nav = grip(page, '导航栏')
  const assistant = grip(page, '助手侧栏')
  const base = await size(nav)
  await nav.press('ArrowRight')
  await rendered(page, nav, base + 16)
  const box = await assistant.boundingBox()
  const before = await size(assistant)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 100, y, { steps: 5 })
  await page.mouse.up()
  await rendered(page, assistant, before + 100)
  await page.reload()
  await rendered(page, assistant, before + 100)
  await nav.press('Enter')
  await assistant.press('Enter')
  await rendered(page, assistant, before)
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:true })
    const point = await assistant.boundingBox()
    const x = point.x + point.width / 2, y = point.y + point.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x,y}] })
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:x-64,y}] })
    await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] })
    await rendered(page, assistant, before + 64)
    await assistant.press('Enter')
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:false })
    await cdp.detach()
  }
}

export async function checkTabletLayout(page, width) {
  await page.getByRole('button', { name: '打开织日助手' }).tap()
  const handle = grip(page, '助手侧栏')
  const hit = await handle.boundingBox()
  assert.ok(hit.width >= 44 && hit.height >= 44)
  const initial = await size(handle)
  const x = hit.x + hit.width / 2, y = hit.y + hit.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 84, y, { steps: 4 })
  await page.mouse.up()
  await rendered(page, handle, initial + 84)
  await page.getByRole('textbox', { name:'给织日助手发消息' }).fill('把助手侧栏宽度调到 520 像素')
  await page.getByRole('button', { name:'发送', exact:true }).tap()
  await page.getByRole('button', { name:'应用宽度' }).tap()
  await rendered(page, handle, 520)
  const originalViewport = page.viewportSize()
  await page.setViewportSize({ width:390, height:844 })
  await rendered(page, handle, 374)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.setViewportSize(originalViewport)
  await rendered(page, handle, 520)
  await page.getByRole('button', { name:'收起助手' }).tap()
  await page.goto('/planner')
  if (width > 1000) {
    const backlog = grip(page, '待安排')
    const before = await size(backlog)
    await backlog.press('ArrowRight')
    await rendered(page, backlog, before + 16)
  } else {
    assert.equal(await grip(page, '待安排').count(), 0)
    await page.getByRole('button', { name: '待安排', exact:true }).tap()
    await page.getByRole('complementary', { name: '待安排' }).waitFor()
  }
  await page.goto('/board')
  const lane = grip(page, '待办')
  const initialLane = await size(lane)
  await lane.press('ArrowRight')
  await rendered(page, lane, initialLane + 16)
  await page.reload()
  await rendered(page, lane, initialLane + 16)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.goto('/')
}

export async function checkCodexPicker(browser, app) {
  const context = await browser.newContext({ ...devices['iPad (gen 11)'], viewport:{ width:820, height:1180 }, baseURL:app.url })
  try {
    await call(context.request, 'POST', '/auth/login', { username:'model-picker', password:app.password })
    const page = await context.newPage()
    await page.goto('/settings?tab=ai')
    await page.getByRole('button', { name:'Codex', exact:true }).tap()
    const model = page.getByRole('combobox', { name:/^默认模型/ })
    const effort = page.getByRole('combobox', { name:/^推理强度/ })
    await page.getByText('本账号已连接 Codex', {exact:true}).waitFor()
    assert.ok(await model.isDisabled())
    assert.equal(await page.getByRole('button', {name:'用 Codex 登录'}).count(), 0)
    await page.getByRole('button', {name:'刷新模型'}).tap()
    await page.waitForFunction(() => document.querySelector('.settings-panel option[value="fixture-fast"]'))
    assert.deepEqual(await model.locator('option').allTextContents(), ['Fixture Fast', 'Fixture Deep'])
    assert.equal(await model.inputValue(), 'fixture-fast')
    assert.equal(await effort.inputValue(), 'auto')
    await model.selectOption({ label:'Fixture Deep' })
    assert.deepEqual(await effort.locator('option').evaluateAll(options => options.map(o => o.value)), ['auto','medium','high'])
    await effort.selectOption('high')
    await page.getByRole('button', { name:'保存配置' }).tap()
    await page.getByText('服务商设置已保存', { exact:true }).waitFor()
    await page.setViewportSize({ width:1180, height:820 })
    await page.reload()
    await page.getByRole('button', { name:'Codex', exact:true }).tap()
    assert.equal(await model.inputValue(), 'fixture-deep')
    assert.equal(await effort.inputValue(), 'high')
  } finally { await context.close() }
}
