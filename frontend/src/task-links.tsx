import { useId, useState } from 'react'
import { ExternalLink, Plus, X } from 'lucide-react'
import { workspaceLink, type PrimaryDestination, type Resource, type TaskLink } from './api'
import { httpTaskUrl, taskLinkLabel } from './link-format'
import { useWorkspace } from './ui'
import './task-links.css'

type Destination = { href: string; label: string; title?: string | null; resourceId?: number }

function external(link: TaskLink): Destination[] {
  const url = httpTaskUrl(link.url)
  return url ? [{ href: url.href, label: taskLinkLabel(link), title: link.title }] : []
}

function resourceLinks(ids: number[], resources: Resource[]): Destination[] {
  if (!ids.length) return []
  return resources.filter(resource => ids.includes(resource.id)).flatMap(resource => {
    if (resource.file_url) return [{ href: workspaceLink(resource.file_url), label: resource.title, resourceId: resource.id }]
    return (resource.url ? external({ url: resource.url, title: resource.title }) : [])
      .map(link => ({ ...link, resourceId: resource.id }))
  })
}

function destinations(ids: number[], links: TaskLink[], resources: Resource[]) {
  const items = resourceLinks(ids, resources)
  const urls = new Set(items.map(item => item.href))
  for (const item of links.flatMap(external)) {
    if (!urls.has(item.href)) { items.push(item); urls.add(item.href) }
  }
  return items
}

function isPrimary(item: Destination, primary?: PrimaryDestination) {
  return item.resourceId != null && item.resourceId === primary?.primary_resource_id ||
    !!primary?.primary_link_url && item.href === httpTaskUrl(primary.primary_link_url)?.href
}

function destinationKey(item: Destination) {
  return item.resourceId != null ? 'resource:' + item.resourceId : item.href
}

function LinkChips({ items, remove }: { items: Destination[]; remove?: (link: Destination) => void }) {
  if (!items.length) return null
  return <div className="task-link-chips">{items.map(link =>
    <span key={link.href} className="task-link-chip">
      <a href={link.href} target="_blank" rel="noopener noreferrer"
        title={[link.title, link.href].filter(Boolean).join('\n')}>
        <span>{link.label}</span><ExternalLink size={13} aria-hidden="true" />
      </a>
      {remove && <button type="button" aria-label={'移除链接' + ' · ' + link.label} onClick={() => remove(link)}>
        <X size={14} aria-hidden="true" />
      </button>}
    </span>)}</div>
}

export function TaskDestinations({ ids = [], links = [], primary }: {
  ids?: number[]; links?: TaskLink[]; primary?: PrimaryDestination
}) {
  const { resources } = useWorkspace()
  const items = destinations(ids, links, resources)
  if (!items.length) return null
  const main = items.find(item => isPrimary(item, primary))
  const others = items.filter(item => item !== main)
  return <div className="work-destinations">
    {main ? <>
      <div className="primary-destination" role="group" aria-label="主要工作入口"><LinkChips items={[main]} /></div>
      {others.length > 0 && <details className="other-destinations">
        <summary>{'其他链接'} ({others.length})</summary>
        <LinkChips items={others} />
      </details>}
    </> : <LinkChips items={items} />}
  </div>
}

export function TaskLinkEditor({ ids, links, primary, onIds, onLinks, onInvalid, onPrimary }: {
  ids: number[]; links: TaskLink[]; onIds: (ids: number[]) => void
  onLinks: (links: TaskLink[]) => void; onInvalid: (invalid: boolean) => void
  primary: PrimaryDestination; onPrimary: (selection: PrimaryDestination) => void
}) {
  const { resources } = useWorkspace()
  const id = useId()
  const [text, setText] = useState('')
  const [editingHref, setEditingHref] = useState('')
  const items = destinations(ids, links, resources)
  const selected = items.find(item => isPrimary(item, primary))
  const parsed = httpTaskUrl(text)
  const invalid = !!text.trim() && !parsed

  function typeLink(next: string) {
    const url = httpTaskUrl(next)
    const others = links.filter(link => httpTaskUrl(link.url)?.href !== editingHref)
    const isNew = url && !items.some(item => item.resourceId != null && item.href === url.href) &&
      !others.some(link => httpTaskUrl(link.url)?.href === url.href)
    // Keep the current valid input in the same payload as the chips, including saves made directly from the input.
    if (editingHref || isNew) onLinks(isNew ? [...others, { url: url.href }] : others)
    if (editingHref && editingHref === selected?.href && url?.href !== editingHref)
      onPrimary({ primary_resource_id: null, primary_link_url: null })
    setEditingHref(isNew ? url.href : '')
    setText(next)
    onInvalid(!!next.trim() && !url)
  }

  function nextLink() {
    if (!parsed) return
    setText('')
    setEditingHref('')
  }

  function remove(item: Destination) {
    if (item.resourceId !== undefined) onIds(ids.filter(id => id !== item.resourceId))
    if (links.some(link => httpTaskUrl(link.url)?.href === item.href))
      onLinks(links.filter(link => httpTaskUrl(link.url)?.href !== item.href))
    if (item.href === parsed?.href) { setEditingHref(''); setText(''); onInvalid(false) }
    if (selected === item) onPrimary({ primary_resource_id: null, primary_link_url: null })
  }
  return <div className="field task-link-field wide">
    <label htmlFor={id}>任务链接</label>
    <div className="task-link-entry">
      <input id={id} type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder="粘贴 Jira 或网页链接" value={text} maxLength={5000} aria-invalid={invalid || undefined}
        aria-describedby={invalid ? id + '-error' : undefined} onChange={e => typeLink(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); nextLink() } }} />
      <button className="secondary" type="button" onClick={nextLink} disabled={!parsed} aria-label="添加链接" title="添加链接">
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
    {invalid && <small id={id + '-error'} className="task-link-error">请输入完整的 http 或 https 链接，且不要包含登录凭据。</small>}
    <LinkChips items={items} remove={remove} />
    {items.length > 1 && <>
      <label htmlFor={id + '-primary'}>主要工作入口</label>
      <select id={id + '-primary'} value={selected ? destinationKey(selected) : ''} onChange={e => {
        const item = items.find(item => destinationKey(item) === e.target.value)
        onPrimary({ primary_resource_id: item?.resourceId ?? null,
          primary_link_url: item && item.resourceId == null ? item.href : null })
      }}>
        <option value="">不指定</option>
        {items.map(item => <option key={item.href} value={destinationKey(item)}>
          {items.some(other => other !== item && other.label === item.label) ? item.label + ' · ' + item.href : item.label}
        </option>)}
      </select>
    </>}
  </div>
}
