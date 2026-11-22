import { useState } from 'react'
import { dateInZone, dateLabel, type Task } from './api'
import { Field } from './ui'
import { monday, shift } from './week-strip'

export type PlanDate = Pick<Task, 'scheduled_date' | 'planning_window' | 'window_start'>

export function PlanDatePicker({ plan, zone, change }: { plan: PlanDate; zone: string; change: (plan: PlanDate) => void }) {
  const [pickDate, setPickDate] = useState(false)
  const today = dateInZone(zone), tomorrow = shift(today, 1)
  const week = monday(today), nextWeek = shift(week, 7), month = today.slice(0, 7) + '-01'
  const day = plan.scheduled_date, anchor = plan.window_start, window = plan.planning_window
  const chosen = pickDate ? 'date' : window === 'week' ? (anchor === week ? 'week' : anchor === nextWeek ? 'next_week' : 'other_week')
    : window === 'month' ? (anchor === month ? 'month' : 'other_month')
    : day === today ? 'today' : day === tomorrow ? 'tomorrow' : day ? 'date' : ''
  function selectDay(date: string | null) {
    change({ scheduled_date: date, planning_window: null, window_start: null })
  }
  const end = anchor && (window === 'week' ? shift(anchor, 6)
    : new Date(Date.UTC(Number(anchor.slice(0,4)), Number(anchor.slice(5,7)), 0, 12)).toISOString().slice(0,10))
  return <>
    <Field label="计划范围" wide>
      <select value={chosen} onChange={e => {
        const value = e.target.value
        setPickDate(value === 'date')
        if (value === 'date') return
        if (value === 'week' || value === 'next_week' || value === 'month') {
          change({ scheduled_date:null, planning_window:value === 'month' ? 'month' : 'week',
            window_start:value === 'month' ? month : value === 'next_week' ? nextWeek : week })
        } else selectDay(value === 'today' ? today : value === 'tomorrow' ? tomorrow : null)
      }}>
        <option value="">未安排</option><option value="today">今天</option><option value="tomorrow">明天</option>
        <option value="week">本周</option><option value="next_week">下周</option><option value="month">本月</option>
        <option value="date">指定日期</option>
        {chosen.startsWith('other_') && <option value={chosen}>{window === 'week' ? '待定周' : '待定月'}</option>}
      </select>
    </Field>
    {!pickDate && window && anchor && end ? <>
      <Field label="计划周期起始日"><input type="date" value={anchor} onChange={e => {
        const value = e.target.value
        if (value) change({ ...plan, window_start:window === 'week' ? monday(value) : value.slice(0,7) + '-01' })
      }} /></Field>
      <div className="plan-window-note">{dateLabel(anchor)} – {dateLabel(end)}<small>具体日期待安排</small></div>
    </> : (day || pickDate) && <Field label="计划日期"><input type="date" value={day ?? ''}
      onChange={e => { setPickDate(true); selectDay(e.target.value || null) }} /></Field>}
  </>
}
