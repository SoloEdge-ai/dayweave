import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, devices } from 'playwright'
import { checkCodexPicker, checkDesktopLayout, checkTabletLayout } from './layout.mjs'
import { call, fixture } from './session.mjs'

const languageControl = /^(界面语言|Language|言語)/
const savePreferences = /^(保存偏好|Save preferences|設定を保存)$/

function audioFixture() {
  if (process.env.DAYWEAVE_TEST_VOICE_WAV) return process.env.DAYWEAVE_TEST_VOICE_WAV
  const pcm = Buffer.alloc(32000)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(pcm.length + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return { name: 'fixture.wav', mimeType: 'audio/wav', buffer: Buffer.concat([header, pcm]) }
}

async function checkVoicePlanner(page, date, tomorrow, width, height) {
  const request = page.context().request
  const title = 'iPad voice planner ' + width
  const tasks = () => call(request, 'GET', '/tasks?q=' + encodeURIComponent(title))
  const originalIds = (await call(request, 'GET', '/tasks')).map(task => task.id)
  await page.goto('/')
  await page.getByRole('link', { name: '用语音创建任务' }).tap()
  await page.getByRole('button', { name: '选择音频', exact: true }).waitFor()
  await page.goto('/planner?view=tomorrow')
  await page.getByRole('heading', { name: '日程编排', exact: true }).waitFor()
  await page.getByRole('button', { name: '打开织日助手' }).tap()
  await page.getByRole('button', { name: '语音输入', exact: true }).tap()
  await page.getByLabel('选择音频文件', { exact: true }).setInputFiles(audioFixture())
  const [transcribed] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/ai/transcribe')),
    page.getByRole('button', { name: '转写到输入框' }).tap(),
  ])
  assert.ok(transcribed.ok(), await transcribed.text())
  const recognized = (await transcribed.json()).text
  assert.match(recognized, /机器人.*(?:跟踪|追踪).*任务/)
  const composer = page.getByRole('textbox', { name: '给织日助手发消息' })
  await page.waitForFunction(expected => document.querySelector('.composer textarea')?.value === expected, recognized)
  assert.deepEqual(await tasks(), [])
  await sendChat(page, recognized)
  const card = page.getByRole('region', { name: '任务草稿' }).last()
  assert.equal(await card.getByLabel('任务标题', { exact: true }).inputValue(), '机器人跟踪')
  await card.getByLabel('任务标题', { exact: true }).fill(title)
  await card.getByLabel('计划日期', { exact: true }).fill(tomorrow)
  await card.getByLabel('截止日期', { exact: true }).fill(tomorrow)
  assert.deepEqual((await call(request, 'GET', '/tasks')).map(task => task.id), originalIds)
  if (process.env.DAYWEAVE_VOICE_SCREENSHOTS === '1') {
    await page.screenshot({ path: fileURLToPath(new URL('../../docs/previews/voice-draft-' + width + '.png', import.meta.url)), scale: 'css' })
  }
  await card.getByRole('button', { name: '确认创建', exact: true }).tap()
  await card.getByRole('button', { name: '在日历查看', exact: true }).tap()
  await page.locator('.planner-day').getByText(title, { exact: true }).waitFor()
  const [created] = await tasks()
  assert.equal(created.scheduled_date, tomorrow)
  assert.equal(created.due_date, tomorrow)
  await page.getByRole('button', { name: '编辑安排 · ' + title }).tap()
  const editor = page.getByRole('dialog', { name: '编辑安排' })
  await editor.getByRole('button', { name: '今天', exact: true }).tap()
  await editor.getByLabel('计划时段', { exact: true }).selectOption('exact')
  await editor.getByLabel('计划开始', { exact: true }).fill('14:00')
  await editor.getByLabel('计划结束', { exact: true }).fill('15:00')
  await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
  await editor.waitFor({ state: 'hidden' })
  const scheduled = await tasks()
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].id, created.id)
  assert.equal(scheduled[0].scheduled_date, date)
  assert.equal(scheduled[0].due_date, tomorrow)
  assert.equal(Date.parse(scheduled[0].planned_start_at), Date.parse(date + 'T14:00+08:00'))
  assert.equal(Date.parse(scheduled[0].planned_end_at), Date.parse(date + 'T15:00+08:00'))
  await page.locator('.planner-day').getByText('14:00–15:00', { exact: true }).first().waitFor()
  if (process.env.DAYWEAVE_VOICE_SCREENSHOTS === '1') {
    await page.screenshot({ path: fileURLToPath(new URL('../../docs/previews/voice-planner-' + width + '.png', import.meta.url)), scale: 'css' })
  }
  if (width === 820) {
    await page.getByRole('button', { name: '编辑安排 · ' + title }).tap()
    await editor.getByLabel('计划开始', { exact: true }).fill('23:00')
    await editor.getByLabel('计划结束', { exact: true }).fill('01:00')
    await editor.getByLabel('结束日期', { exact: true }).fill(tomorrow)
    await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
    await editor.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '编辑安排 · ' + title }).tap()
    const yesterday = new Date(Date.parse(date + 'T12:00Z') - 86400000).toISOString().slice(0, 10)
    await editor.getByLabel('计划日期', { exact: true }).fill(yesterday)
    await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
    await editor.waitFor({ state: 'hidden' })
    const [overnight] = await tasks()
    assert.equal(Date.parse(overnight.planned_end_at) - Date.parse(overnight.planned_start_at), 7200000)
  }
  await page.getByRole('button', { name: '编辑安排 · ' + title }).tap()
  await editor.getByLabel('计划精度').selectOption('inbox')
  await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
  await editor.waitFor({ state: 'hidden' })
  assert.equal((await tasks())[0].scheduled_date, null)
  await page.getByRole('button', { name: '本月', exact: true }).tap()
  const backlogToggle = page.getByRole('button', { name: '待安排', exact: true })
  if (await backlogToggle.isVisible()) await backlogToggle.tap()
  await page.getByRole('complementary', { name: '待安排' }).getByRole('button', { name: new RegExp(title) }).tap()
  await page.getByRole('button', { name: '排入待定日期', exact: true }).tap()
  await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
  await editor.waitFor({ state: 'hidden' })
  await page.locator('.planner-floating').getByText(title, { exact: true }).waitFor()
  assert.equal((await tasks())[0].window_start, date.slice(0, 7) + '-01')
  await page.getByRole('button', { name: '编辑安排 · ' + title }).tap()
  assert.equal(await editor.getByLabel('计划精度').inputValue(), 'window')
  await editor.getByRole('button', { name: '保存安排', exact: true }).tap()
  await editor.waitFor({ state: 'hidden' })
  assert.equal((await tasks())[0].scheduled_date, null)
  await page.getByRole('button', { name: '撤销安排', exact: true }).tap()
  await page.locator('.planner-floating').getByText(title, { exact: true }).waitFor({state: 'hidden'})
  const [restored] = await tasks()
  assert.equal(restored.id, created.id)
  assert.equal(restored.due_date, tomorrow)
  assert.equal(restored.planning_window, null)
  await page.getByRole('button', { name: '下周', exact: true }).tap()
  await page.locator('.planner-weekday').last().waitFor()
  const weekdays = await page.locator('.planner-weekday').allTextContents()
  assert.equal(weekdays[0], '周一')
  assert.equal(weekdays[6], '周日')
  const heading = page.locator('.planner-panel header h2').first()
  const originalRange = await heading.textContent()
  await page.getByRole('button', { name: '后一周' }).tap()
  await page.waitForFunction(text => document.querySelector('.planner-panel header h2')?.textContent !== text, originalRange)
  await page.getByRole('button', { name: '前一周' }).tap()
  await page.getByRole('heading', { name: originalRange, exact: true }).waitFor()
  console.log('PASS WebKit ' + width + 'x' + height + ': transcription, draft, confirmation, exact time, floating month, Monday week and undo')
}
const copies = {
  en: {
    planner: 'Planner', planningScope: 'Planning scope', next: 'Next week', voice: 'Voice input',
    dashboard: 'Today’s overview', newTask: 'New task', title: 'Task title', date: 'Scheduled date',
    minutes: 'Estimate (minutes)', due: 'Due date', composer: 'Message DayWeave', send: 'Send',
    stop: 'Stop generating', reply: 'The test connection is working.', prompt: 'Create a ROS2 tracing task.',
    suggested: 'ROS2 tracing exercise', badLogin: 'The username or password is incorrect.',
    card: 'Task draft', draftTitle: 'Task title', confirm: 'Confirm creation', cancel: 'Cancel draft',
  },
  ja: {
    planner: 'プランナー', planningScope: '予定の範囲', next: '来週', voice: '音声入力',
    dashboard: '今日の概要', newTask: '新規タスク', title: 'タスク名', date: '予定日',
    minutes: '所要時間（分）', due: '期限日', composer: 'アシスタントにメッセージ', send: '送信',
    stop: '生成を停止', reply: 'テスト接続に成功しました。', prompt: 'ROS2 tracing の学習タスクを作成して。',
    suggested: 'ROS2 tracing の演習', badLogin: 'ユーザー名またはパスワードが正しくありません。',
    card: 'タスクの下書き', draftTitle: 'タスクのタイトル', confirm: '作成を確定', cancel: '下書きをキャンセル',
  },
}

async function sendChat(page, content, labels = { composer: '给织日助手发消息', send: '发送', stop: '停止生成' }) {
  await page.getByRole('textbox', { name: labels.composer }).fill(content)
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/ai/chat') && r.request().method() === 'POST'),
    page.getByRole('button', { name: labels.send, exact: true }).click(),
  ])
  assert.ok(response.ok())
  const events = (await response.text()).split('\n')
    .filter(line => line.startsWith('data:') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice(5)))
  await page.getByRole('button', { name: labels.stop, exact: true }).waitFor({ state: 'hidden' })
  assert.equal(events.some(e => e.type === 'error'), false, JSON.stringify(events))
  return events
}

async function checkLoginLocales(page) {
  for (const [language, labels] of Object.entries(copies)) {
    await page.getByRole('combobox', { name: languageControl }).selectOption(language)
    await page.reload()
    await page.waitForFunction(lang => document.documentElement.lang === lang, language)
    const field = page.locator('input[type=password]')
    await page.locator('input[autocomplete=username]').fill('admin')
    await field.fill('incorrect-fixture-password')
    const [failure] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/auth/login')), field.press('Enter'),
    ])
    assert.equal(failure.status(), 401)
    assert.equal(failure.headers()['content-language'], language)
    assert.equal((await failure.json()).code, 'auth.invalid_password')
    await page.getByText(labels.badLogin, { exact: true }).waitFor()
  }
  await page.getByRole('combobox', { name: languageControl }).selectOption('zh-CN')
  console.log('PASS unauthenticated language selection, reload and localized sign-in feedback in English and Japanese')
}

async function checkAccountIsolation(page, app, firstTasks) {
  await call(page.request, 'PATCH', '/settings', { language: 'zh-CN' })
  await page.goto('/')
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await page.locator('input[autocomplete=username]').fill('second-user')
  const email = 'second-user@example.org'
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByText('验证码邮件未能确认发送，请重试。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByLabel('邮箱验证码').fill(await app.receivedCodes(email, 1))
  await page.locator('input[type=password]').fill('separate-fixture-password')
  await page.getByRole('button', { name: '注册并登录' }).click()
  await page.getByRole('heading', { name: '今日总览' }).waitFor()
  assert.deepEqual(await call(page.request, 'GET', '/tasks'), [])
  assert.deepEqual(await call(page.request, 'GET', '/ai/conversations'), [])
  await page.getByRole('textbox', { name: '快捷录入' }).fill('Second account task')
  await page.getByRole('textbox', { name: '快捷录入' }).press('Enter')
  await page.getByText('任务已放入收件箱', { exact: true }).waitFor()
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.locator('input[autocomplete=username]').fill('admin')
  await page.locator('input[type=password]').fill(app.password)
  await page.getByRole('button', { name: '进入工作区' }).click()
  await page.getByRole('heading', { name: '今日总览' }).waitFor()
  assert.deepEqual((await call(page.request, 'GET', '/tasks')).map(t => t.title), firstTasks.map(t => t.title))
  assert.ok((await call(page.request, 'GET', '/ai/conversations')).length)
  await page.getByRole('button', { name: '管理工作区' }).click()
  await page.getByRole('button', { name: '新建工作区' }).click()
  await page.getByLabel('工作区名称').fill('Shared browser workspace')
  await page.getByRole('button', { name: '创建工作区' }).click()
  await page.getByRole('dialog', { name: '创建工作区' }).waitFor({ state: 'hidden' })
  const spaces = await call(page.request, 'GET', '/workspaces')
  const shared = spaces.find(row => row.name === 'Shared browser workspace')
  assert.ok(shared)
  await page.getByRole('button', { name: '管理工作区' }).click()
  await page.getByLabel('成员用户名').fill('second-user')
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByText('second-user', { exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('textbox', { name: '快捷录入' }).fill('Shared browser task')
  await page.getByRole('textbox', { name: '快捷录入' }).press('Enter')
  await page.getByText('任务已放入收件箱', { exact: true }).waitFor()
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('button', { name: '忘记密码？' }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByRole('button', { name: '发送验证码' }).click()
  await page.getByLabel('邮箱验证码').fill(await app.receivedCodes(email, 2))
  await page.locator('input[type=password]').fill('replacement-fixture-password')
  await page.getByRole('button', { name: '重设密码' }).click()
  await page.getByText('密码已更新，请重新登录。').waitFor()
  await page.locator('input[type=password]').fill('replacement-fixture-password')
  await page.getByRole('button', { name: '进入工作区' }).click()
  const switcher = page.getByRole('combobox', { name: '切换工作区' })
  await switcher.selectOption({ label: shared.name })
  await page.goto('/tasks/inbox')
  await page.getByRole('checkbox', { name: '完成“Shared browser task”' }).waitFor()
  assert.equal(await page.getByText('Second account task', { exact: true }).count(), 0)
  console.log('PASS account registration, workspace creation, inviting a member and switching sharable task data')
}

async function checkWorkspaceLocales(page, api) {
  for (const [language, labels] of Object.entries(copies)) {
    await page.goto('/settings')
    await page.getByRole('combobox', { name: languageControl }).selectOption(language)
    const [saved] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: savePreferences }).click(),
    ])
    assert.equal((await saved.json()).language, language)
    await page.goto('/')
    await page.reload()
    await page.getByRole('heading', { name: labels.dashboard, exact: true }).waitFor()
    assert.equal(await page.locator('html').getAttribute('lang'), language)
    await page.goto('/planner')
    await page.getByRole('heading', { name: labels.planner, exact: true }).waitFor()
    await page.getByRole('navigation', { name: labels.planningScope }).getByRole('button', { name: labels.next, exact: true }).click()
    await page.locator('.planner-weekday').last().waitFor()
    await page.goto('/chat')
    await page.getByRole('button', { name: labels.voice, exact: true }).click()
    await page.getByRole('region', { name: labels.voice, exact: true }).waitFor()
    await page.goto('/tasks/all')
    await page.getByRole('button', { name: labels.newTask, exact: true }).first().click()
    const editor = page.getByRole('dialog', { name: labels.newTask })
    await editor.getByLabel(labels.title, { exact: true }).fill('Unsubmitted bilingual record')
    assert.equal(await editor.getByLabel(labels.date, { exact: true }).getAttribute('type'), 'date')
    assert.equal(await editor.getByLabel(labels.due, { exact: true }).getAttribute('type'), 'date')
    assert.equal(await editor.getByLabel(labels.minutes, { exact: true }).getAttribute('type'), 'number')
    await page.goto('/chat')
    await sendChat(page, 'Locale smoke', labels)
    await page.getByText(labels.reply, { exact: true }).last().waitFor()
    const events = await sendChat(page, labels.prompt, labels)
    const proposal = events.find(e => e.type === 'task_draft')
    assert.equal(proposal?.drafts[0]?.task?.title, labels.suggested)
    const card = page.getByRole('region', { name: labels.card, exact: true })
      .filter({ has: page.getByRole('button', { name: labels.confirm, exact: true }) })
    assert.equal(await card.getByLabel(labels.draftTitle, { exact: true }).inputValue(), labels.suggested)
    await card.getByRole('button', { name: labels.cancel, exact: true }).click()
    assert.deepEqual(await call(api, 'GET', '/tasks?q=' + encodeURIComponent(labels.suggested)), [])
    console.log('PASS ' + language + ' workspace, editor, language-directed model response and pending draft')
  }
}

async function waitForSavedDraft(api, id, expected) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const draft = await call(api, 'GET', '/ai/confirmations/' + id)
    if (draft.status === 'pending' && draft.drafts.some(row =>
      Object.entries(expected).every(([key, value]) => row.task[key] === value))) {
      return draft
    }
    await delay(150)
  }
  assert.fail('Draft edits did not persist before reloading the chat')
}

async function checkExactDraft(page, api) {
  const zone = 'America/New_York'
  await call(api, 'PATCH', '/settings', { timezone: zone })
  await page.goto('/chat')
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  const proposal = (await sendChat(page, '明天下午花一个小时学习 ROS2 tracing，周五前完成笔记。'))
    .find(e => e.type === 'task_draft')
  const title = 'DST precision readback'
  await call(api, 'PATCH', '/ai/confirmations/' + proposal.id + '/draft', {
    version: proposal.version, drafts: [{ index: 0, task: {
      title, scheduled_date: '2030-03-10', scheduled_period: null, due_date: null,
      planned_start_at: '2030-03-10T01:30:12.123456-05:00', planned_end_at: '2030-03-10T03:45:00-04:00',
      due_at: '2030-03-10T20:15:00-04:00',
    } }],
  })
  await page.reload()
  const card = page.getByRole('region', { name: '任务草稿', exact: true })
  const start = card.getByLabel('计划开始 · ' + zone, { exact: true })
  const end = card.getByLabel('计划结束', { exact: true })
  const due = card.getByLabel('精确截止时刻', { exact: true })
  await start.waitFor({state: 'visible'})
  assert.equal(await start.inputValue(), '2030-03-10T01:30:12.123')
  assert.equal(await end.inputValue(), '2030-03-10T03:45')
  assert.equal(await due.inputValue(), '2030-03-10T20:15')
  const accept = card.getByRole('button', { name: '确认创建', exact: true })
  await due.fill('2030-03-10T02:10')
  assert.equal(await due.getAttribute('aria-invalid'), 'true')
  assert.ok(await accept.isDisabled())
  await card.getByText('该时间在当前时区不存在，请重新选择。').waitFor()
  await due.fill('2030-03-10T21:10')
  await due.press('Tab')
  const edited = await waitForSavedDraft(api, proposal.id, {due_at:'2030-03-11T01:10:00Z', due_date:null})
  assert.equal(edited.drafts[0].task.planned_start_at, '2030-03-10T06:30:12.123456Z')
  await card.getByLabel('截止日期', {exact:true}).fill('2030-03-11')
  await waitForSavedDraft(api, proposal.id, {due_date:'2030-03-11',due_at:null})
  assert.equal(await due.inputValue(), '')
  await end.fill('2030-03-10T04:10')
  await end.press('Tab')
  await waitForSavedDraft(api, proposal.id, { planned_end_at:'2030-03-10T08:10:00Z' })
  const [approved] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/ai/confirmations/' + proposal.id) && r.request().method() === 'POST'),
    accept.click(),
  ])
  assert.ok(approved.ok(), await approved.text())
  const [task] = await call(api, 'GET', '/tasks?q=' + encodeURIComponent(title))
  assert.equal(task.planned_start_at, '2030-03-10T06:30:12.123456+00:00')
  assert.equal(Date.parse(task.planned_end_at), Date.parse('2030-03-10T08:10:00Z'))
  assert.equal(task.due_date, '2030-03-11')
  assert.equal(task.due_at, null)
  await call(api, 'PATCH', '/settings', {timezone: 'Asia/Hong_Kong'})
  console.log('PASS draft exposes localized exact times, rejects a DST gap, preserves microseconds and date-only deadlines')
}

const app = await fixture()
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ baseURL: app.url, viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const faults = []
  page.on('pageerror', error => faults.push(String(error)))
  await page.goto('/')
  await checkLoginLocales(page)
  await page.locator('input[autocomplete=username]').fill('admin')
  await page.locator('input[type=password]').fill(app.password)
  await page.locator('input[type=password]').press('Enter')
  await page.getByRole('heading', { name: '今日总览' }).waitFor()
  const api = page.context().request
  await checkDesktopLayout(page)
  const { date } = await call(api, 'GET', '/dashboard/today')
  const tomorrow = new Date(Date.parse(date + 'T12:00Z') + 86400000).toISOString().slice(0, 10)
  await page.getByRole('textbox', { name: '快捷录入' }).fill('Browser acceptance task')
  await page.getByRole('textbox', { name: '快捷录入' }).press('Enter')
  await page.getByText('任务已放入收件箱', { exact: true }).waitFor()
  await page.goto('/tasks/inbox')
  await page.getByRole('button', { name: '编辑“Browser acceptance task”' }).click()
  await page.getByLabel('计划日期', { exact: true }).fill(tomorrow)
  await page.getByRole('button', { name: '保存任务' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.goto('/tasks/tomorrow')
  await page.getByRole('heading', { name: '明天', exact: true }).waitFor()
  await page.getByRole('checkbox', { name: '完成“Browser acceptance task”' }).click()
  await page.getByText('任务已完成', { exact: true }).waitFor()
  const [completed] = await call(api, 'GET', '/tasks?view=completed&q=Browser')
  assert.equal(completed.status, 'done')
  assert.equal(completed.scheduled_date, tomorrow)
  assert.ok(completed.completed_at)
  console.log('PASS browser login, capture, edit, Tomorrow, complete and database readback')

  await page.goto('/library')
  await page.getByRole('button', { name: '添加资料', exact: true }).first().click()
  const link = 'https://www.youtube.com/watch?v=DayWeaveDemo'
  await page.getByLabel('资料链接', { exact: true }).fill(link)
  await page.getByLabel('标题', { exact: true }).fill('Browser video')
  await page.getByRole('button', { name: '保存资料' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '安排阅读或观看' }).click()
  await page.getByLabel('计划日期', { exact: true }).fill(date)
  await page.getByRole('button', { name: '保存任务' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.goto('/tasks/today')
  const taskTitle = '观看《Browser video》'
  await page.getByRole('button', { name: '编辑“' + taskTitle + '”' }).click()
  const resourceLink = page.getByRole('link', { name: 'Browser video', exact: true })
  assert.equal(await resourceLink.getAttribute('href'), link)
  await page.context().route('https://www.youtube.com/**', route => route.fulfill({ body: 'Video fixture' }))
  const [popup] = await Promise.all([page.waitForEvent('popup'), resourceLink.click()])
  await popup.waitForLoadState()
  assert.equal(popup.url(), link)
  await popup.close()
  console.log('PASS save video, schedule viewing and open linked resource from its task')

  await page.goto('/settings?tab=ai')
  await page.getByRole('button', { name: 'OpenAI 兼容接口', exact: true }).click()
  await page.getByLabel('API Key', { exact: true }).fill('browser-fixture-secret')
  await page.getByLabel('接口地址（Base URL）').fill('https://fixture.invalid/v1')
  await page.getByLabel('设为默认服务商').check()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('已连接', { exact: true }).waitFor()
  const providers = await call(api, 'GET', '/ai/providers')
  assert.equal(providers.find(p => p.id === 'compatible').model, 'dayweave-fixture')
  assert.ok(!JSON.stringify(providers).includes('browser-fixture-secret'))
  await page.goto('/chat')
  await page.getByRole('textbox', { name: '给织日助手发消息' }).fill('测试当前连接')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('本地测试连接成功。', { exact: true }).waitFor()
  const [conversation] = await call(api, 'GET', '/ai/conversations')
  const history = await call(api, 'GET', '/ai/conversations/' + conversation.id)
  assert.ok(history.messages.some(m => m.content === '本地测试连接成功。'))
  console.log('PASS provider setup, model catalog, streamed chat and persistent transcript with a local simulator')

  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  const request = '明天下午花一个小时学习 ROS2 tracing，周五前完成笔记。'
  const renamed = 'ROS2 tracing 实践复盘'
  const proposalEvents = await sendChat(page, request)
  const initial = proposalEvents.find(e => e.type === 'task_draft')
  assert.ok(initial && initial.status === 'pending', 'creating a task must first yield an editable draft')
  const proposed = initial.drafts[0].task
  assert.equal(proposed.scheduled_date, tomorrow)
  assert.equal(proposed.scheduled_period, 'afternoon')
  assert.equal(proposed.estimated_minutes, 60)
  assert.equal(new Date(proposed.due_date + 'T12:00Z').getUTCDay(), 5)
  const queriedTasks = () => call(api, 'GET', '/tasks?q=ROS2')
  assert.deepEqual(await queriedTasks(), [])
  const card = page.getByRole('region', { name: '任务草稿', exact: true })
  await card.getByLabel('任务标题', { exact: true }).fill(renamed)
  await card.getByLabel('计划日期', { exact: true }).fill(date)
  await card.getByLabel('预计耗时（分钟）', { exact: true }).fill('45')
  await card.getByLabel('预计耗时（分钟）', { exact: true }).press('Tab')
  const expected = { title: renamed, scheduled_date: date, estimated_minutes: 45 }
  const edited = await waitForSavedDraft(api, initial.id, expected)
  assert.ok(edited.version > initial.version)
  assert.deepEqual(await queriedTasks(), [])
  await page.reload()
  await card.getByLabel('任务标题', { exact: true }).waitFor()
  assert.equal(await card.getByLabel('任务标题', { exact: true }).inputValue(), renamed)
  assert.equal(await card.getByLabel('计划日期', { exact: true }).inputValue(), date)
  assert.equal(await card.getByLabel('预计耗时（分钟）', { exact: true }).inputValue(), '45')
  const conversations = await call(api, 'GET', '/ai/conversations')
  const draftConversation = conversations.find(c => c.id === proposalEvents.find(e => e.type === 'conversation')?.id)
  assert.ok(draftConversation, 'the draft should be discoverable from chat history')
  const draftBrowser = await webkit.launch()
  try {
    const tablet = await draftBrowser.newContext({
      ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 },
      storageState: await page.context().storageState(), baseURL: app.url, locale: 'zh-CN',
    })
    const touch = await tablet.newPage()
    await touch.goto('/chat')
    await touch.getByRole('button', { name: '历史对话' }).tap()
    await touch.getByRole('button', { name: draftConversation.title, exact: true }).tap()
    const tabletCard = touch.getByRole('region', { name: '任务草稿', exact: true })
    assert.equal(await tabletCard.getByLabel('任务标题', { exact: true }).inputValue(), renamed)
    const [decision] = await Promise.all([
      touch.waitForResponse(r => r.url().endsWith('/api/ai/confirmations/' + initial.id) && r.request().method() === 'POST'),
      tabletCard.getByRole('button', { name: '确认创建', exact: true }).tap(),
    ])
    assert.ok(decision.ok(), await decision.text())
    await touch.getByText('已创建', { exact: true }).first().waitFor()
    await tablet.close()
  } finally {
    await draftBrowser.close()
  }
  const saved = await queriedTasks()
  assert.equal(saved.length, 1)
  const [createdByChat] = saved
  for (const [key, value] of Object.entries(expected)) assert.equal(createdByChat[key], value)
  assert.equal(createdByChat.status, 'todo')
  assert.equal(createdByChat.due_date, proposed.due_date)
  assert.equal(createdByChat.planned_start_at, null)
  const approved = await call(api, 'GET', '/ai/confirmations/' + initial.id)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.drafts[0].task_id, createdByChat.id)
  await page.reload()
  await page.getByText('已创建', { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('button', { name: '确认创建', exact: true }).count(), 0)
  const completedEvents = await sendChat(page, '把 ' + renamed + ' 标记完成')
  assert.ok(completedEvents.some(e => e.type === 'tool' && e.name === 'complete_task'))
  assert.equal((await queriedTasks())[0].status, 'done')
  await page.goto('/tasks/today')
  await page.getByRole('checkbox', { name: '重新打开“' + renamed + '”' }).waitFor()
  console.log('PASS draft edits survive reload, iPad confirmation creates exactly one edited task, chat completes it')

  await page.goto('/chat')
  const cancelDraft = (await sendChat(page, '为 ROS2 tracing 创建取消用例')).find(e => e.type === 'task_draft')
  assert.ok(cancelDraft)
  const cancel = page.getByRole('button', { name: '取消草稿', exact: true })
  const [cancelled] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/ai/confirmations/' + cancelDraft.id) && r.request().method() === 'POST'),
    cancel.click(),
  ])
  assert.ok(cancelled.ok(), await cancelled.text())
  assert.equal((await call(api, 'GET', '/ai/confirmations/' + cancelDraft.id)).status, 'cancelled')
  assert.deepEqual((await queriedTasks()).map(t => t.id), [createdByChat.id])
  await page.reload()
  await page.getByText('草稿已取消', { exact: true }).first().waitFor()
  assert.equal(await cancel.count(), 0)
  console.log('PASS cancelled draft stays cancelled in history and creates no task')
  await checkExactDraft(page, api)

  await page.goto('/settings')
  await page.getByRole('combobox', { name: /^外观/ }).selectOption('dark')
  await page.getByRole('button', { name: '保存偏好' }).click()
  await page.getByText('偏好已保存', { exact: true }).waitFor()
  await page.reload()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal((await call(api, 'GET', '/settings')).theme, 'dark')
  console.log('PASS saved theme persists after reloading the workspace')

  const tabletBrowser = await webkit.launch()
  try {
    await checkCodexPicker(tabletBrowser, app)
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      const tablet = await tabletBrowser.newContext({
        ...devices['iPad (gen 11)'], viewport: { width, height }, storageState: await page.context().storageState(),
        baseURL: app.url, locale: 'zh-CN', timezoneId: 'Asia/Hong_Kong'
      })
      const touch = await tablet.newPage()
      await touch.goto('/')
      await checkTabletLayout(touch, width)
      await touch.getByRole('button', { name: '打开织日助手' }).tap()
      await touch.getByRole('button', { name: '收起助手' }).tap()
      if (width === 820) await touch.getByRole('button', { name: '打开导航' }).tap()
      await touch.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '今天', exact: true }).tap()
      const edit = touch.getByRole('button', { name: '编辑“' + taskTitle + '”' })
      await edit.tap()
      const dialog = touch.getByRole('dialog', { name: '编辑任务' })
      await dialog.waitFor()
      await dialog.getByRole('combobox', { name: /^优先级/ }).selectOption(width === 820 ? 'high' : 'low')
      if (width === 820) {
        await touch.setViewportSize({ width: 610, height: 660 })
        const save = await touch.getByRole('button', { name: '保存任务' }).boundingBox()
        assert.ok(save && save.y >= 0 && save.y + save.height <= 661, 'save action must remain visible in a short tablet viewport')
      }
      await touch.getByRole('button', { name: '保存任务' }).tap()
      await touch.getByRole('dialog').waitFor({ state: 'hidden' })
      await touch.setViewportSize({ width, height })
      const toggle = touch.getByRole('checkbox', { name: new RegExp(taskTitle) })
      const hit = await toggle.boundingBox()
      assert.ok(hit && hit.width >= 44 && hit.height >= 44, 'tablet touch target must be 44x44 or larger')
      await toggle.tap()
      await touch.getByText(width === 820 ? '任务已完成' : '任务已重新打开', { exact: true }).waitFor()
      const [record] = await call(tablet.request, 'GET', '/tasks?view=all&q=Browser%20video')
      assert.equal(record.status, width === 820 ? 'done' : 'todo')
      assert.equal(record.priority, width === 820 ? 'high' : 'low')
      await touch.goto('/board')
      const lane = touch.locator('.board-column.state-in_progress')
      const boardTitle = 'Touch board ' + width
      await lane.getByRole('button', { name: /添加任务/ }).tap()
      await lane.getByLabel('任务标题').fill(boardTitle)
      await lane.getByRole('button', { name: '添加', exact: true }).tap()
      await lane.getByRole('button', {name: new RegExp(boardTitle)}).tap()
      await dialog.getByLabel('任务名称', {exact:true}).fill(boardTitle + ' edited')
      await dialog.getByRole('button', {name:'保存任务'}).tap()
      await dialog.waitFor({state:'hidden'})
      await touch.getByRole('searchbox', {name:'搜索任务'}).fill(boardTitle)
      await touch.getByRole('group', {name:'任务布局'}).getByRole('button', {name:'列表'}).tap()
      await touch.getByText(boardTitle + ' edited', {exact:true}).waitFor()
      assert.equal((await call(tablet.request, 'GET', '/tasks?q=' + encodeURIComponent(boardTitle)))[0].status, 'in_progress')
      await checkVoicePlanner(touch, date, tomorrow, width, height)
      await tablet.close()
      console.log('PASS WebKit touch task editor and checkbox at ' + width + 'x' + height)
    }
  } finally {
    await tabletBrowser.close()
  }
  await page.goto('/chat')
  const composer = page.getByRole('textbox', {name:'给织日助手发消息'})
  await composer.fill('登录 Codex')
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await page.getByRole('button', {name:'用 Codex 登录'}).waitFor()
  assert.ok(await page.getByRole('combobox', {name:/^默认模型/}).isDisabled())
  await page.getByText('如何开启设备代码登录？', {exact:true}).click()
  assert.equal(await page.getByRole('link', {name:'打开 ChatGPT'}).getAttribute('href'), 'https://chatgpt.com/')
  await page.getByRole('button', {name:'返回对话'}).click()
  await composer.fill('创建工作区')
  await page.getByRole('button', {name:'发送', exact:true}).click()
  await page.getByRole('region', {name:'工作区操作'}).getByRole('button', {name:'创建工作区'}).click()
  await page.getByRole('dialog', {name:'创建工作区'}).getByLabel('工作区名称').waitFor()
  await page.keyboard.press('Escape')
  console.log('PASS account settings and workspace creation from chat')
  await checkWorkspaceLocales(page, api)
  await checkAccountIsolation(page, app, await call(api, 'GET', '/tasks'))
  assert.deepEqual(faults, [])
} finally {
  await browser.close()
  app.stop()
}
