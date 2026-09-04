/**
 * Util dampak (Sprint 6) — kartu "Pohon Kebaikanmu" `beranda.html`.
 *
 * Pohon bertumbuh mengikuti TOTAL AKSI NYATA pengguna (scan bernilai poin +
 * misi disetujui — angka dari `GET /v1/profile`; teks UI diturunkan murni di
 * sini sehingga mikrokonteks dan logika tak mungkin pisah, pola streak).
 * Tahap: Bibit → Tunas → Pohon Muda → Pohon Subur → Pohon Mangga (puncak).
 */

export interface ImpactStage {
  /** Nama tahap kini ("Bibit", …, "Pohon Mangga"). */
  label: string
  /** Tahap berikutnya (null saat puncak). */
  nextLabel: string | null
  /** Aksi lagi menuju tahap berikutnya (0 saat puncak). */
  actionsToNext: number
  /** Persen progres tahap kini (0–100) — utk pbar ARIA. */
  percent: number
  isMax: boolean
  /** Mikrokonteks kartu, gaya mockup: "Tumbuh menjadi … — butuh N aksi lagi." */
  hint: string
}

const STAGES: Array<{ label: string; min: number }> = [
  { label: 'Bibit', min: 0 },
  { label: 'Tunas', min: 5 },
  { label: 'Pohon Muda', min: 15 },
  { label: 'Pohon Subur', min: 30 },
  { label: 'Pohon Mangga', min: 50 },
]

/** Hitung tahap pohon dari total aksi nyata (fungsi murni, teruji). */
export function impactStage(totalActions: number): ImpactStage {
  const safe = Math.max(0, Math.floor(totalActions))
  let index = 0
  for (let i = 0; i < STAGES.length; i += 1) {
    if (safe >= STAGES[i].min) index = i
  }
  const current = STAGES[index]
  const next = STAGES[index + 1] ?? null

  if (next === null) {
    return {
      label: current.label,
      nextLabel: null,
      actionsToNext: 0,
      percent: 100,
      isMax: true,
      hint: `${current.label}mu subur rimbun — pertahankan aksimu setiap hari!`,
    }
  }

  const span = next.min - current.min
  const done = safe - current.min
  const percent = span <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((done / span) * 100)))
  const left = Math.max(0, next.min - safe)
  return {
    label: current.label,
    nextLabel: next.label,
    actionsToNext: left,
    percent,
    isMax: false,
    hint: `Tumbuh menjadi ${next.label.toLowerCase()} — butuh ${left} aksi lagi.`,
  }
}

/** Label pbar ARIA. */
export function impactAriaLabel(stage: ImpactStage): string {
  if (stage.isMax) return `Pohon ${stage.label} — tahap tertinggi`
  return `Progres pohon tahap ${stage.label}, ${stage.percent}% menuju ${stage.nextLabel}`
}
