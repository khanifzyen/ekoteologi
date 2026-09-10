/** Service Misi (Sprint 4–5 → Sprint 12: route hook klaim + engine server). */

import { ApiError, currentUserId, pb, toApiError } from '@/api/client'
import type { BadgeItem, ClaimResponse, Mission, MissionsPage } from '@/types/mission'

/**
 * Sprint 12: klaim lewat route hook `POST /api/ekoteologi/missions/{id}/claim`
 * — periode, consent, status, dan auto-approve manual dihitung server; poin
 * selalu lewat ledger append-only + notifikasi in-app dari hook (tidak ada
 * lagi field klaim yang dikirim klien).
 */

function toApiErrorClaim(err: unknown): ApiError {
  // Pelanggaran anti dobel klaim → 409 agar UI menampilkan sheet "Sudah
  // Diklaim" (pesan ramah sudah dari server; fallback untuk error lama).
  const e = toApiError(err)
  if (e.status === 400 && /UNIQUE|unique/i.test(e.message)) {
    return new ApiError(409, 'Kamu sudah mengklaim misi ini untuk periode ini.')
  }
  return e
}

/** Kontrak klaim server (status "submitted") → kontrak UI ("pending"). */
function mapClaimResponse(data: Record<string, unknown>): ClaimResponse {
  const claim = (data.claim ?? {}) as Record<string, unknown>
  const status = (claim.status as string) || 'in_progress'
  return {
    claim: {
      id: String(claim.id ?? ''),
      status: (status === 'submitted' ? 'pending' : status) as
        | 'in_progress'
        | 'pending'
        | 'approved'
        | 'rejected',
      progress_count: Number(claim.progress_count ?? 0),
      points_awarded: Number(claim.points_awarded ?? 0),
      review_note: (claim.review_note as string) || null,
      submitted_at: (claim.submitted_at as string) || null,
    },
    message: (data.message as string) || '',
    points_total: typeof data.points_total === 'number' ? (data.points_total as number) : undefined,
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** period_date lokal (YYYY-MM-DD) untuk misi daily/special. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Senin minggu berjalan (paritas period_date_for server — weekly). */
function localMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

    // Klaim per periode berjalan (server menulis period_date sebagai
    // "YYYY-MM-DD 00:00:00.000Z" — bandingkan bagian tanggalnya).
    const monday = localMonday()
    const today = localToday()
    const periodOf = (missionType: string): string =>
      missionType === 'weekly' ? monday : today
    const claimByPeriod = new Map<string, Record<string, unknown>>()
    let weekDone = 0
    let weekPoints = 0
    for (const claim of claimRows) {
      const periodDay = String(claim.period_date ?? '').slice(0, 10)
      const missionId = String(claim.mission ?? '')
      const key = `${missionId}:${periodDay}`
      // klaim terbaru menang (daftar terurut -created)
      if (!claimByPeriod.has(key)) claimByPeriod.set(key, claim)
      if ((claim.status as string) === 'approved' && periodDay >= monday) {
        weekDone += 1
        weekPoints += Number(claim.points_awarded ?? 0)
      }
    }

    const items: Mission[] = missionRows.map((row) => {
      const id = String(row.id)
      const type = ((row.type as string) || 'daily') as Mission['type']
      const claim = claimByPeriod.get(`${id}:${periodOf(type)}`)
      return {
        id,
        title: String(row.title ?? ''),
        description: (row.description as string) || null,
        type,
        icon: (row.icon as string) || null,
        points: Number(row.points ?? 0),
        verification: ((row.verification as string) || 'manual') as Mission['verification'],
        required_count: Number(row.required_count ?? 1),
        start_at: (row.start_at as string) || null,
        end_at: (row.end_at as string) || null,
        my_claim: claim
          ? {
              id: String(claim.id ?? ''),
              status: (((claim.status as string) || 'in_progress') === 'submitted'
                ? 'pending'
                : ((claim.status as string) || 'in_progress')) as
                | 'in_progress'
                | 'pending'
                | 'approved'
                | 'rejected',
              progress_count: Number(claim.progress_count ?? 0),
              points_awarded: Number(claim.points_awarded ?? 0),
              review_note: (claim.review_note as string) || null,
              submitted_at: (claim.submitted_at as string) || null,
            }
          : null,
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
 * Klaim misi photo: unggah bukti + consent → antrian verifikasi `submitted`
 * (validasi consent/foto/ukuran server-side — PRD §9).
 */
export async function claimPhoto(
  missionId: string,
  photo: Blob,
  consent: boolean,
): Promise<ClaimResponse> {
  const form = new FormData()
  if (consent) form.append('consent', '1')
  form.append('proof', photo, 'bukti-misi.jpg')
  try {
    const data = (await pb.send(`/api/ekoteologi/missions/${missionId}/claim`, {
      method: 'POST',
      body: form,
      requestKey: null,
    })) as Record<string, unknown>
    return mapClaimResponse(data)
  } catch (err) {
    throw toApiErrorClaim(err)
  }
}

/** Klaim misi manual — auto-approve di server: poin langsung lewat ledger. */
export async function claimManual(missionId: string): Promise<ClaimResponse> {
  try {
    const data = (await pb.send(`/api/ekoteologi/missions/${missionId}/claim`, {
      method: 'POST',
      body: {},
      requestKey: null,
    })) as Record<string, unknown>
    return mapClaimResponse(data)
  } catch (err) {
    throw toApiErrorClaim(err)
  }
}

/**
 * Lencana tab Pencapaian — route hook dengan lazy badge sync server: kriteria
 * dievaluasi dulu (idempoten) sehingga lencana yang layak tapi belum diraih
 * lewat event (mis. poin dari penyesuaian admin) tetap terbayar di sini.
 */
export async function fetchBadges(): Promise<BadgeItem[]> {
  try {
    const rows = (await pb.send('/api/ekoteologi/badges', {
      method: 'GET',
      requestKey: null,
    })) as Array<Record<string, unknown>>
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row.id ?? ''),
      code: String(row.code ?? ''),
      name: (row.name as string) || null,
      icon: (row.icon as string) || null,
      description: (row.description as string) || null,
      earned: row.earned === true,
      earned_at: (row.earned_at as string) || null,
    }))
  } catch (err) {
    throw toApiError(err)
  }
}

export type { Mission }
