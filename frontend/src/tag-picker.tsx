import { useState } from 'react'
import { X } from 'lucide-react'
import { errorText, useApi, type Tag } from './api'
import { ErrorBox, Field } from './ui'

export function TagPicker({ selected, change }: { selected: string[]; change: (tags: string[]) => void }) {
  const catalog = useApi<Tag[]>('/tags')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const key = (value: string) => value.trim().toLowerCase()
  const has = (value: string) => selected.some(tag => key(tag) === key(value))

  function add(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const existing = catalog.data?.find(tag => key(tag.name) === key(trimmed))
    if (!has(trimmed)) change([...selected, existing?.name ?? trimmed])
    setName('')
    setCreating(false)
  }

  return <div className="tag-picker wide">
    <Field label="标签">
      <select value="" onChange={e => {
        if (e.target.value === 'new') {
          setCreating(true)
        } else {
          const tag = catalog.data?.find(option => String(option.id) === e.target.value)
          if (tag) add(tag.name)
        }
      }}>
        <option value="" disabled>选择标签</option>
        <option value="new">＋ 新建标签</option>
        {catalog.data?.map(tag =>
          <option key={tag.id} value={tag.id} disabled={has(tag.name)}>{tag.name}</option>)}
      </select>
    </Field>
    {catalog.error && <ErrorBox message={errorText(catalog.error)} retry={() => void catalog.refetch()} />}
    {creating && <div className="tag-create">
      <input aria-label="新标签名称" placeholder="新标签名称" maxLength={300} autoFocus value={name}
        onChange={e => setName(e.target.value)} onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); add(name) }
          if (e.key === 'Escape') { e.stopPropagation(); setName(''); setCreating(false) }
        }} />
      <button type="button" className="secondary" disabled={!name.trim()} onClick={() => add(name)}>添加</button>
      <button type="button" className="icon-btn" aria-label="取消新建标签" onClick={() => {setName(''); setCreating(false)}}><X size={16} /></button>
    </div>}
    {selected.length > 0 && <div className="tag-chips">{selected.map(tag =>
      <button key={tag} type="button" className="tag-chip" aria-label={'移除标签' + ' · ' + tag}
        onClick={() => change(selected.filter(name => name !== tag))}>
        <span>{tag}</span><X size={14} aria-hidden="true" />
      </button>)}</div>}
  </div>
}
