import type { TaskLink } from './api'

export function httpTaskUrl(value: string): URL | null {
  const text = value.trim()
  if (!/^https?:\/\//i.test(text) || /[\s\\]/.test(text)) return null
  try {
    const url = new URL(text)
    return url.hostname && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export function taskLinkLabel(link: TaskLink): string {
  const url = httpTaskUrl(link.url)
  if (!url) return link.title?.trim() || link.url
  const issue = url.pathname.match(/\/browse\/([a-z][a-z0-9_]*-\d+)\/?$/i)
  if (issue) return 'Jira · ' + issue[1].toUpperCase()
  const path = url.pathname.replace(/\/$/, '')
  const title = link.title?.trim()
  if (title && title !== url.host + path) return title
  const shortPath = path.length > 42 ? '/…/' + path.split('/').slice(-2).join('/') : path
  return url.host + shortPath
}
