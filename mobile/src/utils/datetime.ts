/** Format tanggal/waktu id-ID (riwayat scan, sheet hasil). */

const dateFmt = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const shortDateFmt = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' })

export function formatDateLong(value: string | Date): string {
  return dateFmt.format(new Date(value))
}

export function formatDateShort(value: string | Date): string {
  return shortDateFmt.format(new Date(value))
}

export function formatTime(value: string | Date): string {
  return timeFmt.format(new Date(value))
}

/** "Kemarin", "Hari ini", atau tanggal pendek — label grup riwayat. */
export function relativeDay(value: string | Date): string {
  const date = new Date(value)
  const today = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Hari ini'
  if (diffDays === 1) return 'Kemarin'
  return formatDateShort(date)
}
