/** Service Misi (Sprint 4–5 → Sprint 10: koleksi `missions` + `user_missions`). */

import { ApiError, currentUserId, pb, toApiError } from '@/api/client'
import type { BadgeItem, ClaimResponse, Mission, MissionsPage } from '@/types/mission'

/**
 * Klaim manual lama auto-approve + poin lewat ledger server; hook ledger &
 * transisi status baru hidup di Sprint 12 — sementara klaim tercatat dengan
 * status `submitted` dan poin ditambahkan modul gamifikasi (catatan laporan).
 */
const CLAIM_PENDING_MESSAGE =
  'Klaim tercatat — poin akan ditambahkan otomatis di pembaruan berikutnya.'

/** period_date hari ini (YYYY-MM-DD 00:00 UTC — kunci anti dobel klaim). */
function todayPeriod(): string {
  return `${new Date().toISOString().slice(0, 10)} 00:00:00.000Z`
}

function mapClaim(row: Record<string, unknown>) {
  const status = (row.status as string) || 'in_progress'
  return {
    id: String(row.id),
    // Kontrak UI memakai "pending" — koleksi PB memakai "submitted".
    status: (status === 'submitted' ? 'pending' : status) as
      | 'in_progress'
      | 'pending'
      | 'approved'
      | 'rejected',
    progress_count: Number(row.progress_count ?? 0),
    points_awarded: Number(row.points_awarded ?? 0),
    review_note: (row.review_note as string) || null,
    submitted_at: (row.submitted_at as string) || null,
  }
}

/** Daftar misi aktif + klaim saya pada periode berjalan + ringkasan mingguan. */
export async function fetchMissions(): Promise<MissionsPage> {
  const uid = currentUserId()
  try {
    const [missionRows, claimRows] = await Promise.all([
      pb.collection('missions').getFullList<Record<string, unknown>>({
        filter: 'is_active = true',
        sort: '-created',
      }),
      pb.collection('user_missions').getFullList<Record<string, unknown>>({
        filter: `user = "${uid}"`,
        sort: '-created',
      }),
    ])

    // Klaim terbaru per misi = my_claim periode berjalan.
    const latestByMission = new Map<string, Record<string, unknown>>()
    for (const claim of claimRows) {
      const missionId = String(claim.mission ?? '')
      if (!latestByMission.has(missionId)) latestByMission.set(missionId, claim)
    }

    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)) // Senin
    let weekDone = 0
    let weekPoints = 0
    for (const claim of claimRows) {
      const approvedAt = (claim.reviewed_at as string) || (claim.submitted_at as string) || ''
      if ((claim.status as string) === 'approved' && approvedAt && new Date(approvedAt) >= weekStart) {
        weekDone += 1
        weekPoints += Number(claim.points_awarded ?? 0)
      }
    }

    const items: Mission[] = missionRows.map((row) => {
      const id = String(row.id)
      const claim = latestByMission.get(id)
      return {
        id,
        title: String(row.title ?? ''),
        description: (row.description as string) || null,
        type: ((row.type as string) || 'daily') as Mission['type'],
        icon: (row.icon as string) || null,
        points: Number(row.points ?? 0),
        verification: ((row.verification as string) || 'manual') as Mission['verification'],
        required_count: Number(row.required_count ?? 1),
        start_at: (row.start_at as string) || null,
        end_at: (row.end_at as string) || null,
        my_claim: claim ? mapClaim(claim) : null,
      }
    })

    return {
      items,
      summary: {
        week_done: weekDone,
        week_total: items.length,
        week_points: weekPoints,
      },
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * Klaim misi photo: unggah bukti → status `submitted` (antrian verifikasi —
 * antrian admin berjalan via rules yang ada; ledger menyusul Sprint 12).
 */
export async function claimPhoto(
  missionId: string,
  photo: Blob,
  consent: boolean,
): Promise<ClaimResponse> {
  const form = new FormData()
  form.append('user', currentUserId())
  form.append('mission', missionId)
  form.append('period_date', todayPeriod())
  form.append('status', 'submitted')
  form.append('submitted_at', new Date().toISOString())
  if (consent) form.append('consent_at', new Date().toISOString())
  form.append('proof', photo, 'bukti-misi.jpg')
  try {
    const row = (await pb.collection('user_missions').create(form)) as Record<string, unknown>
    return { claim: mapClaim(row), message: CLAIM_PENDING_MESSAGE }
  } catch (err) {
    // Pelanggaran unique index (anti dobel klaim) → 409 agar UI menampilkan
    // sheet "Sudah Diklaim" seperti sebelumnya.
    const e = toApiError(err)
    const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {}
    if (e.status === 400 && (data.period_date || data.mission)) {
      throw new ApiError(409, 'Kamu sudah mengklaim misi ini untuk periode ini.')
    }
    throw e
  }
}

/** Klaim misi manual — tercatat sebagai klaim (lihat catatan modul gamifikasi). */
export async function claimManual(missionId: string): Promise<ClaimResponse> {
  try {
    const row = (await pb.collection('user_missions').create({
      user: currentUserId(),
      mission: missionId,
      period_date: todayPeriod(),
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      note: 'klaim manual',
    })) as Record<string, unknown>
    return { claim: mapClaim(row), message: CLAIM_PENDING_MESSAGE }
  } catch (err) {
    const e = toApiError(err)
    const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {}
    if (e.status === 400 && (data.period_date || data.mission)) {
      throw new ApiError(409, 'Kamu sudah mengklaim misi ini untuk periode ini.')
    }
    throw e
  }
}

/** Lencana tab Pencapaian — definisi publik + yang sudah diraih user. */
export async function fetchBadges(): Promise<BadgeItem[]> {
  const uid = currentUserId()
  try {
    const [badgeRows, earnedRows] = await Promise.all([
      pb.collection('badges').getFullList<Record<string, unknown>>({ sort: 'code' }),
      pb.collection('user_badges').getFullList<Record<string, unknown>>({
        filter: `user = "${uid}"`,
      }),
    ])
    const earnedAt = new Map<string, string>()
    for (const row of earnedRows) {
      earnedAt.set(String(row.badge ?? ''), String(row.created ?? ''))
    }
    return badgeRows.map((row) => {
      const id = String(row.id)
      const at = earnedAt.get(id) ?? null
      return {
        id,
        code: String(row.code ?? ''),
        name: (row.name as string) || null,
        icon: (row.icon as string) || null,
        description: (row.description as string) || null,
        earned: at !== null,
        earned_at: at,
      }
    })
  } catch (err) {
    throw toApiError(err)
  }
}

export type { Mission }
