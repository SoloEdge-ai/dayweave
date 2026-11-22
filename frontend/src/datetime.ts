/** Format an absolute instant for an HTML datetime-local control in the configured zone. */
export function localInput(
  iso: string | null | undefined,
  zone: string,
): string {
  if (!iso) return ''
  const instant = new Date(iso)
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  )
  let local = `${values.year.padStart(4, '0')}-${values.month}-${values.day}T${values.hour}:${values.minute}`
  const milliseconds = instant.getUTCMilliseconds()
  if (values.second !== '00' || milliseconds) local += ':' + values.second
  if (milliseconds) local += '.' + String(milliseconds).padStart(3, '0')
  return local
}

/** Round trip through the zone to reject nonexistent local times in a DST gap. */
export function toIso(
  value: string,
  zone: string,
  previous?: string | null,
): string | null {
  if (!value) return null
  const wanted = Date.parse(value + 'Z')
  // Keep the original offset choice in a repeated hour and any sub-millisecond precision.
  if (previous && wanted === Date.parse(localInput(previous, zone) + 'Z'))
    return previous
  let stamp = wanted
  for (let attempt = 0; Number.isFinite(stamp) && attempt < 4; attempt++) {
    const iso = new Date(stamp).toISOString()
    const actual = Date.parse(localInput(iso, zone) + 'Z')
    if (actual === wanted) return iso
    stamp += wanted - actual
  }
  throw new Error('该时间在当前时区不存在，请重新选择。')
}
