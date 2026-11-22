import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, devices, request } from 'playwright'
import { call, fixture } from './session.mjs'

const out = process.env.DAYWEAVE_SCREENSHOT_DIR ||
  fileURLToPath(new URL('../../docs/previews/', import.meta.url))
await mkdir(out, { recursive: true })
const app = await fixture()
const sampleMessage = '明天下午花一个小时学习 ROS2 tracing，周五前完成笔记。'
async function showDraft(page) {
  await page.goto('/chat')
  await page.getByRole('textbox', { name: '给织日助手发消息' }).fill(sampleMessage)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const card = page.getByRole('region', { name: '任务草稿' }).last()
  await card.getByRole('button', { name: '确认创建' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}
try {
  const api = await request.newContext({ baseURL: app.url })
  await call(api, 'POST', '/auth/login', { password: app.password })
  const { date } = await call(api, 'GET', '/dashboard/today')
  const tomorrow = new Date(Date.parse(date + 'T12:00Z') + 86400000).toISOString().slice(0, 10)
  const create = (endpoint, data) => call(api, 'POST', '/' + endpoint, data)
  const project = await create('projects', { name: '机器人导航', description: '整理导航链路的观测工具和联调笔记。' })
  const learning = await create('projects', { name: '个人学习' })
  const resource = await create('resources', { title: 'ROS 2 tracing 入门指南', type: 'web', source: 'ROS 2 Docs',
    url: 'https://docs.ros.org/en/rolling/Tutorials/Advanced/ROS2-Tracing-Trace-and-Analyze.html', project_ids: [learning.id],
    current_position: 35, progress_status: 'in_progress' })
  const task = (title, fields) => create('tasks', { title, scheduled_date: date, ...fields })
  await task('完成导航接口联调', { project_id: project.id, category: '工作', estimated_minutes: 90,
    pinned: true, priority: 'high', status: 'in_progress', due_date: tomorrow, scheduled_period: 'morning' })
  await task('学习 ROS2 tracing', { project_id: learning.id, category: '学习', estimated_minutes: 60,
    scheduled_period: 'afternoon', resource_ids: [resource.id] })
  await task('去书店取预订的书', { category: '生活', estimated_minutes: 20, priority: 'low', scheduled_period: 'evening' })
  await task('整理上周实验笔记', { category: '工作', status: 'done', estimated_minutes: 25, project_id: project.id })
  await task('确认下一轮测试窗口', { scheduled_date: null, due_date: date, priority: 'high' })
  await task('复核测试记录', { scheduled_date: tomorrow, project_id: project.id })
  const offset = (iso, days) => new Date(Date.parse(iso + 'T12:00Z') + days * 86400000).toISOString().slice(0, 10)
  const monday = offset(date, -((new Date(date + 'T12:00Z').getUTCDay() + 6) % 7))
  const weekSamples = [
    ['设备联调', 0, '10:00', 45],
    ['整理书单', 1, '18:30', 20],
    ['测试记录复盘', 2, '14:00', 60],
    ['校准里程计', 3, '09:30', 40],
    ['阅读导航论文', 4, '15:00', 30],
    ['周末采购', 5, '11:00', 25],
  ]
  for (const [title, index, time, minutes] of weekSamples) {
    const target = offset(monday, index)
    if (target !== date) await task(title, { scheduled_date: target, planned_start_at: target + 'T' + time + ':00+08:00', estimated_minutes: minutes })
  }
  await call(api, 'PATCH', '/ai/providers/compatible', {
    base_url: 'https://fixture.invalid/v1', api_key: 'local-preview', name: '本地示例', model: 'dayweave-fixture'
  })
  await call(api, 'POST', '/ai/providers/compatible/test')
  await call(api, 'PATCH', '/settings', { default_provider: 'compatible', default_model: 'dayweave-fixture' })
  const login = await api.storageState()
  await api.dispose()
  if (process.argv.includes('--interactive')) {
    const browser = await chromium.launch({ headless: false })
    const page = await browser.newPage({ baseURL: app.url, storageState: login, locale: 'zh-CN',
      timezoneId: 'Asia/Hong_Kong', viewport: { width: 1440, height: 960 } })
    try {
      await showDraft(page)
      console.log('The interactive demo uses a disposable workspace. Close its window to end the session.')
      await page.waitForEvent('close', { timeout: 0 })
    } finally {
      await browser.close()
    }
  } else {
  const layouts = [
    ['desktop', chromium, { viewport: { width: 1440, height: 1000 } }],
    ['ipad-portrait', webkit, { ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 } }],
    ['ipad-landscape', webkit, { ...devices['iPad (gen 11) landscape'], viewport: { width: 1180, height: 820 } }],
    ['phone', chromium, { ...devices['Pixel 7'], viewport: { width: 393, height: 852 } }]
  ]
  for (const [name, engine, config] of layouts) {
    const browser = await engine.launch()
    try {
      const context = await browser.newContext({ ...config, baseURL: app.url, storageState: login,
        deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Hong_Kong', colorScheme: 'light' })
      const page = await context.newPage()
      await page.goto('/')
      await page.getByText('完成导航接口联调', { exact: true }).first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      const extent = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      assert.ok(extent[0] <= config.viewport.width + 1 && extent[1] <= config.viewport.width + 1,
        name + ' overflows horizontally: ' + extent.join('/'))
      await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' })
      if (name === 'ipad-portrait') {
        await page.getByRole('button', { name: '编辑“学习 ROS2 tracing”' }).tap()
        await page.getByRole('dialog', { name: '编辑任务' }).waitFor()
        await page.screenshot({ path: path.join(out, 'ipad-edit.png'), animations: 'disabled' })
      }
      if (name === 'ipad-landscape') {
        await page.getByRole('button', { name: '打开织日助手' }).tap()
        await page.getByRole('dialog', { name: '织日助手' }).waitFor()
        const divider = page.getByRole('separator', { name:'调整宽度 · 助手侧栏' })
        await divider.press('Shift+ArrowLeft')
        await divider.press('Shift+ArrowLeft')
        await page.screenshot({ path: path.join(out, 'ipad-assistant.png'), animations: 'disabled' })
      }
      if (name === 'desktop' || name === 'ipad-portrait' || name === 'phone') {
        await showDraft(page)
        const screenshot = name === 'ipad-portrait' ? 'ipad-draft' : name + '-draft'
        await page.screenshot({ path: path.join(out, screenshot + '.png'), animations: 'disabled' })
      }
      if (name === 'desktop' || name.startsWith('ipad-')) {
        await page.goto('/board')
        await page.getByRole('region', { name: '任务看板' }).getByText('完成导航接口联调', { exact: true }).waitFor()
        await page.evaluate(() => document.fonts.ready)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
        await page.screenshot({ path: path.join(out, name + '-board.png'), animations: 'disabled' })
        await page.getByRole('button', { name: '管理工作区' }).click()
        await page.getByRole('button', { name: '新建工作区' }).click()
        await page.getByLabel('工作区名称').fill('设计团队')
        await page.screenshot({ path: path.join(out, name + '-workspace.png'), animations: 'disabled' })
      }
      if (name.startsWith('ipad-')) {
        await page.goto('/planner?view=week&date=' + date)
        await page.locator('.planner-day').getByText('学习 ROS2 tracing', { exact: true }).waitFor()
        await page.screenshot({ path: path.join(out, name + '-planner.png'), animations: 'disabled' })
        if (name === 'ipad-portrait') {
          await page.context().clearCookies()
          await page.goto('/')
          await page.getByRole('button', { name: '创建账号', exact: true }).click()
          await page.getByLabel('邮箱验证码').waitFor()
          await page.screenshot({ path: path.join(out, 'ipad-register.png'), animations: 'disabled' })
        }
      }
      console.log(name + ' ' + config.viewport.width + 'x' + config.viewport.height)
    } finally {
      await browser.close()
    }
  }
  }
} finally {
  app.stop()
}
