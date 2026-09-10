/**
 * Auth store mobile (Sprint 10 — PocketBase SDK).
 *
 * Sesi = auth store bawaan SDK (token + record terpersist di localStorage
 * WebView — token persist & refresh otomatis via `authRefresh` saat sesi
 * dipulihkan). Profil = gabungan record `users` + agregasi ringan (level dari
 * koleksi `levels`, hitungan scan/misi/lencana dari koleksi milik user).
 * Engine poin/ledger/streak sebenarnya hidup di hook (Sprint 11–12).
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, currentUserId, fileUrl, pb, toApiError } from '@/api/client'

export interface MobileUser {
  id: string
  email: string | null
  full_name: string
  role: string
  /** URL absolut file avatar PocketBase (null bila belum mengunggah). */
  avatar_url: string | null
  city: string | null
  points: number
}

export interface ProfileData extends MobileUser {
  level: number
  level_title: string
  /** Level berikutnya + streak (kompatibel kontrak UI lama). */
  next_level?: number | null
  next_level_title?: string | null
  next_level_points?: number | null
  current_streak?: number
  longest_streak?: number
  /** Statistik dampak — kartu "Pohon Kebaikanmu" & layar profil. */
  scans_total?: number
  missions_approved?: number
  badges_earned?: number
  /** % progres di level berjalan (null saat puncak). */
  level_progress?: number | null
}

interface LevelRow {
  id: string
  level: number
  min_points: number
  title: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<MobileUser | null>(null)
  const profile = ref<ProfileData | null>(null)
  /** true setelah percobaan pemulihan sesi awal selesai (sukses/gagal). */
  const sessionRestored = ref(false)

  const isAuthenticated = computed(() => pb.authStore.isValid && user.value !== null)
  const firstName = computed(() => user.value?.full_name.trim().split(/\s+/)[0] ?? '')

  function pickUser(record: Record<string, unknown>): MobileUser {
    return {
      id: String(record.id),
      email: (record.email as string) ?? null,
      full_name: (record.full_name as string) ?? '',
      role: (record.role as string) || 'user',
      avatar_url: fileUrl(record as { id: string }, record.avatar as string),
      city: (record.city as string) || null,
      points: Number(record.points ?? 0),
    }
  }

  /** Tangga level → posisi + progres (satu query, dipakai semua layar). */
  async function loadLevels(): Promise<LevelRow[]> {
    return pb.collection('levels').getFullList<LevelRow>({ sort: 'level' })
  }

  function levelInfo(levels: LevelRow[], points: number) {
    let current = levels[0]
    let next: LevelRow | null = null
    for (const row of levels) {
      if (points >= row.min_points) current = row
      else if (!next) next = row
    }
    const prevMin = current?.min_points ?? 0
    const progress = next && next.min_points > prevMin
      ? Math.min(100, Math.round(((points - prevMin) / (next.min_points - prevMin)) * 100))
      : null
    return { current, next, progress }
  }

  /** Total baris milik user pada satu koleksi (count ringan). */
  async function countOwn(collection: string, filter: string): Promise<number> {
    const page = await pb.collection(collection).getList(1, 1, {
      filter,
      fields: 'id',
    })
    return page.totalItems
  }

  /**
   * Susun profil lengkap dari record users + agregasi koleksi.
   * (Agregasi server-side menyusul via route hook — Sprint 11–13.)
   */
  async function buildProfile(levels?: LevelRow[]): Promise<ProfileData> {
    const record = pb.authStore.record as Record<string, unknown> | null
    if (!record) throw new ApiError(401, 'Sesi berakhir. Silakan masuk lagi.')
    const base = pickUser(record)
    const uid = base.id
    const ladder = levels ?? (await loadLevels())
    const { current, next, progress } = levelInfo(ladder, base.points)
    const [scansTotal, missionsApproved, badgesEarned] = await Promise.all([
      countOwn('scans', `user = "${uid}"`),
      countOwn('user_missions', `user = "${uid}" && status = "approved"`),
      countOwn('user_badges', `user = "${uid}"`),
    ])
    return {
      ...base,
      level: current?.level ?? 1,
      level_title: current?.title ?? 'Pemula',
      next_level: next?.level ?? null,
      next_level_title: next?.title ?? null,
      next_level_points: next?.min_points ?? null,
      current_streak: Number(record.current_streak ?? 0),
      longest_streak: Number(record.longest_streak ?? 0),
      scans_total: scansTotal,
      missions_approved: missionsApproved,
      badges_earned: badgesEarned,
      level_progress: progress,
    }
  }

  function syncFromAuthStore() {
    const record = pb.authStore.record as Record<string, unknown> | null
    user.value = record ? pickUser(record) : null
  }
  pb.authStore.onChange(() => syncFromAuthStore())
  syncFromAuthStore()

  async function login(email: string, password: string, remember = true) {
    // `remember` dipertahankan utk kompatibilitas UI; SDK PocketBase selalu
    // mempersist sesi di penyimpanan WebView (token persist).
    void remember
    try {
      await pb.collection('users').authWithPassword(email.trim(), password)
      syncFromAuthStore()
      profile.value = await buildProfile()
      sessionRestored.value = true
    } catch (err) {
      throw toApiError(err)
    }
  }

  /** Daftar → role dipaksa `user` oleh rule+hook server → langsung masuk. */
  async function register(fullName: string, email: string, password: string) {
    try {
      await pb.collection('users').create({
        email: email.trim(),
        password,
        passwordConfirm: password,
        full_name: fullName.trim(),
      })
    } catch (err) {
      throw toApiError(err)
    }
    await login(email, password)
  }

  /** Ambil profil (+level, statistik) dari server; aman dipanggil berulang. */
  async function ensureProfile() {
    if (!isAuthenticated.value) return
    profile.value = await buildProfile()
  }

  /**
   * Pulihkan sesi dari penyimpanan saat aplikasi dibuka + refresh token
   * otomatis (token PB berumur terbatas — authRefresh memperbarui jika masih
   * valid, dan mengakhiri sesi bila sudah ditolak server).
   */
  async function restoreSession() {
    if (!pb.authStore.isValid) {
      user.value = null
      profile.value = null
      sessionRestored.value = true
      return
    }
    try {
      await pb.collection('users').authRefresh()
      syncFromAuthStore()
      await ensureProfile()
    } catch {
      // 401 → authStore otomatis dibersihkan SDK; offline → tetap tampilkan
      // data lokal dan Home yang menangani retry.
      if (!pb.authStore.isValid) {
        user.value = null
        profile.value = null
      }
    } finally {
      sessionRestored.value = true
    }
  }

  async function updateProfile(fields: { full_name?: string; city?: string }) {
    try {
      const record = await pb.collection('users').update(currentUserId(), fields)
      user.value = pickUser(record as Record<string, unknown>)
      profile.value = await buildProfile()
      return profile.value
    } catch (err) {
      throw toApiError(err)
    }
  }

  /** Unggah avatar (field file `avatar` — maks 2MB, divalidasi server). */
  async function uploadAvatar(file: File) {
    try {
      const form = new FormData()
      form.append('avatar', file)
      const record = await pb.collection('users').update(currentUserId(), form)
      user.value = pickUser(record as Record<string, unknown>)
      profile.value = await buildProfile()
      return profile.value
    } catch (err) {
      throw toApiError(err)
    }
  }

  /** Perbarui total poin dari respons server (mis. hasil scan — Sprint 11). */
  function applyPoints(pointsTotal: number) {
    if (user.value) user.value = { ...user.value, points: pointsTotal }
    if (profile.value) profile.value = { ...profile.value, points: pointsTotal }
  }

  /** Tambah poin delta + segarkan profil (level bisa berubah). */
  function addPoints(delta: number) {
    if (user.value) user.value = { ...user.value, points: user.value.points + delta }
    if (profile.value) profile.value = { ...profile.value, points: profile.value.points + delta }
    void refreshProfile()
  }

  /** Ambil profil dari server walau sudah ada di cache (sinkron level/streak). */
  async function refreshProfile() {
    if (!isAuthenticated.value) return
    profile.value = await buildProfile()
  }

  function logout() {
    pb.authStore.clear()
    user.value = null
    profile.value = null
    sessionRestored.value = true
  }

  return {
    user,
    profile,
    sessionRestored,
    isAuthenticated,
    firstName,
    login,
    register,
    logout,
    ensureProfile,
    restoreSession,
    updateProfile,
    uploadAvatar,
    applyPoints,
    addPoints,
    refreshProfile,
  }
})
