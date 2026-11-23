import assert from 'node:assert/strict'
import path from 'node:path'
import { call } from './session.mjs'

const lane = (page, status) => page.locator('.board-column.state-' + status)
const card = (page, id) => page.locator('#board-task-' + id)
const statusResponse = (page, id) => page.waitForResponse(r =>
  r.url().endsWith('/api/tasks/' + id + '/status') && r.request().method() === 'PATCH')

async function point(locator) {
  return locator.evaluate(node => {
    const rect = node.getBoundingClientRect()
    const board = node.closest('.board-scroll').getBoundingClientRect()
    const left = Math.max(rect.left, board.left, 0), right = Math.min(rect.right, board.right, innerWidth)
    const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight)
    if (right <= left || bottom <= top) throw new Error('Expected a visible drag point')
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) }
  })
}

async function checkTouchScroll(page, task) {
  const api = page.context().request
  const url = '/tasks/' + task.id
  const viewport = page.viewportSize()
  const cdp = await page.context().newCDPSession(page)
  async function send(type, point) {
    await cdp.send('Input.dispatchTouchEvent', {type, touchPoints:point ? [point] : []})
  }
  try {
    await call(api, 'PATCH', url, {status:'todo'})
    await page.setViewportSize({width:700, height:900})
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:true})
    await page.reload()
    const source = card(page,task.id)
    await source.scrollIntoViewIfNeeded()
    let start = await point(source)
    await send('touchStart', start)
    for (const distance of [18,45,75,95]) await send('touchMove', {x:start.x-distance, y:start.y})
    await send('touchEnd')
    await page.waitForFunction(() => document.querySelector('.board-scroll').scrollLeft > 20)
    assert.equal((await call(api, 'GET', url)).status,'todo')
    assert.equal(await page.getByRole('dialog').count(),0)
    await page.locator('.board-scroll').evaluate(node => { node.scrollLeft = 0 })
    await source.scrollIntoViewIfNeeded()
    start = await point(source)
    await send('touchStart', start)
    await page.locator('.drag-overlay').waitFor()
    const edgeX = await page.locator('.board-scroll').evaluate(node => Math.floor(node.getBoundingClientRect().right - 10))
    for (let i = 1; i <= 8; i++) {
      await send('touchMove', {x:Math.round(start.x + (edgeX - start.x) * i / 8), y:start.y})
    }
    await page.waitForFunction(({x,y}) => !!document.elementFromPoint(x,y)?.closest('.state-cancelled'), {x:edgeX,y:start.y})
    const dest = await point(lane(page,'cancelled'))
    await send('touchMove',dest)
    await page.locator('.state-cancelled.drop-target').waitFor()
    const result = statusResponse(page,task.id)
    await send('touchEnd')
    assert.ok((await result).ok())
    assert.equal((await call(api,'GET',url)).status,'cancelled')
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:false})
    await cdp.detach()
    await page.setViewportSize(viewport)
  }
}

export async function checkBoardMouse(page) {
  const api = page.context().request
  const task = await call(api, 'POST', '/tasks', {title:'Board movement fixture', status:'todo', tags:['Delivery']})
  const url = '/tasks/' + task.id
  await page.goto('/board?q=Board+movement+fixture')
  const source = card(page, task.id)
  await source.scrollIntoViewIfNeeded()
  const from = await point(source)
  const target = lane(page,'in_progress')
  const dest = await point(target)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(dest.x, dest.y, {steps:12})
  await page.locator('.state-in_progress.drop-target').waitFor()
  const moving = statusResponse(page, task.id)
  await page.mouse.up()
  assert.ok((await moving).ok())
  await page.reload()
  await target.locator('.board-card').waitFor()
  assert.equal(await target.locator('.lane-count').innerText(), '1')
  assert.equal(await lane(page,'todo').locator('.lane-count').innerText(), '0')

  const finish = statusResponse(page, task.id)
  await source.press('Alt+ArrowRight')
  assert.ok((await finish).ok())
  const done = await call(api,'GET',url)
  assert.ok(done.completed_at)
  assert.deepEqual(done.tags, ['Delivery'])
  await page.reload()
  await lane(page,'done').locator('.board-card').waitFor()
  // Another workspace member changes the state while this board is idle.
  await call(api,'PATCH',url,{status:'cancelled'})
  const conflict = statusResponse(page,task.id)
  await source.press('Alt+ArrowLeft')
  assert.equal((await conflict).status(),409)
  await page.getByRole('alert').getByText('任务状态已被更改，请查看最新看板后重试。').waitFor()
  await lane(page,'cancelled').locator('.board-card').waitFor()
  assert.equal((await call(api,'GET',url)).completed_at, null)
  await checkTouchScroll(page, task)
  await call(api,'DELETE',url+'?confirm=true')
  console.log('PASS desktop card drag, keyboard completion, persistence and conflicting moves')
}

export async function checkBoardTouch(page, task, width) {
  const api = page.context().request
  await page.goto('/board?q=' + encodeURIComponent(task.title))
  const source = card(page, task.id)
  await source.waitFor()
  const target = lane(page, 'todo')
  // Start with the first two adjacent columns visible on both tablet sizes.
  await page.locator('.board-scroll').evaluate(node => { node.scrollLeft = 0 })
  const from = await point(source), to = await point(target)
  // Playwright WebKit exposes taps only. Dispatch a WebKit touch sequence on the original touch target.
  async function touch(type, pos) {
    await source.evaluate((node, {type, pos}) => {
      const event = document.createEvent('TouchEvent')
      event.initEvent(type, true, true)
      const contact = {identifier:1, target:node, clientX:pos.x, clientY:pos.y}
      const contacts = ['touchend','touchcancel'].includes(type) ? [] : [contact]
      Object.defineProperties(event, {touches:{value:contacts}, changedTouches:{value:[contact]}})
      node.dispatchEvent(event)
    }, {type, pos})
  }
  await touch('touchstart', from)
  await page.locator('.drag-overlay').waitFor()
  await touch('touchmove', to)
  await page.locator('.state-todo.drop-target').waitFor()
  if (process.env.DAYWEAVE_DRAG_PREVIEWS) await page.screenshot({
    path:path.join(process.env.DAYWEAVE_DRAG_PREVIEWS,'board-drag-'+width+'.png'), scale:'css',
  })
  const moved = statusResponse(page,task.id)
  await touch('touchend', to)
  assert.ok((await moved).ok())
  await page.reload()
  await target.locator('.board-card').waitFor()
  const updated = await call(api,'GET','/tasks/'+task.id)
  assert.equal(updated.status,'todo')
  assert.equal(updated.window_start,task.window_start)
  assert.equal(updated.due_period,'evening')
  assert.equal(await page.getByRole('dialog').count(),0)
  console.log('PASS iPad WebKit drag and saved state at width '+width)
}
