import { Link } from 'react-router-dom'
import { dateLabel, type Task } from './api'

export const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()
export const shift = (date: string, days: number) =>
  new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
export const monday = (date: string) => shift(date, -((weekday(date) + 6) % 7))

export function WeekStrip({ selected, today, tasks }: { selected: string; today: string; tasks?: Task[] }) {
  const start = monday(selected)
  return <nav className="week-strip" aria-label="选择计划日期">
    {Array.from({ length: 7 }, (_, index) => {
      const date = shift(start, index)
      const count = tasks?.filter(task => task.scheduled_date === date && task.status !== 'cancelled').length
      const label = dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })
      return <Link key={date} to={date === today ? '/planner?view=today' : date === shift(today, 1) ? '/planner?view=tomorrow' : '/planner?view=today&date=' + date}
        aria-label={count === undefined ? label : label + ' · ' + '任务' + ' ' + count}
        aria-current={date === today ? 'date' : undefined} className={date === selected ? 'selected' : ''}>
        <small>{dateLabel(date, { weekday: 'short' })}</small>
        <strong>{Number(date.slice(-2))}</strong>
        {count !== undefined && <span className="week-load" aria-hidden="true">{Array.from({ length: Math.min(3, count) }, (_, n) => <i key={n} />)}</span>}
      </Link>
    })}
  </nav>
}
