/**
 * Layanan kamera web (Sprint 3) — preview langsung via getUserMedia.
 *
 * Keputusan teknis (risiko plan §6: plugin camera-preview tidak konsisten
 * antar vendor): preview memakai WebView/browser API standar
 * (`navigator.mediaDevices.getUserMedia`) tanpa plugin native tambahan;
 * fallback foto statis memakai input file (`pickFromGallery`), setara
 * `@capacitor/camera` tanpa dependensi baru. Saat `getUserMedia` tidak
 * tersedia (WebView lama/izin ditolak permanen), UI otomatis menawarkan
 * mode galeri.
 */

export class CameraUnavailableError extends Error {
  /** denied | notfound | busy | unsupported */
  reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'CameraUnavailableError'
    this.reason = reason
  }
}

const CAPTURE_MAX_EDGE = 1280 // sisi terpanjang foto hasil jepret (hemat kuota)
const CAPTURE_QUALITY = 0.85

export interface CameraHandle {
  /** Ambil frame saat ini sebagai JPEG Blob (untuk POST /v1/scan). */
  capture: () => Promise<Blob>
  /** Coba nyalakan/matikan lampu kilat; false bila perangkat tak mendukung. */
  setTorch: (on: boolean) => Promise<boolean>
  torchSupported: () => boolean
  stop: () => void
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** Mulai preview kamera belakang pada elemen `<video>`. */
export async function startCamera(video: HTMLVideoElement): Promise<CameraHandle> {
  if (!cameraSupported()) {
    throw new CameraUnavailableError('unsupported', 'Perangkat tidak mendukung kamera langsung.')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1920 },
      },
      audio: false,
    })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraUnavailableError('denied', 'Akses kamera ditolak perangkat.')
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraUnavailableError('notfound', 'Kamera tidak ditemukan.')
    }
    throw new CameraUnavailableError('busy', 'Kamera sedang dipakai aplikasi lain.')
  }

  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  try {
    await video.play()
  } catch {
    /* autoplay policy — pengguna cukup menekan shutter; frame tetap tersedia */
  }

  const [track] = stream.getVideoTracks()
  const capabilities: MediaTrackCapabilities & { torch?: boolean } =
    typeof track?.getCapabilities === 'function' ? track.getCapabilities() : {}

  return {
    async capture() {
      if (!video.videoWidth || !video.videoHeight) {
        throw new CameraUnavailableError('busy', 'Kamera belum siap.')
      }
      const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new CameraUnavailableError('unsupported', 'Canvas tidak tersedia.')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Gagal memproses foto.'))),
          'image/jpeg',
          CAPTURE_QUALITY,
        )
      })
    },
    async setTorch(on: boolean) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: on } as MediaTrackConstraintSet],
        })
        return true
      } catch {
        return false
      }
    },
    torchSupported: () => capabilities.torch === true,
    stop() {
      stream.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    },
  }
}

/**
 * Pilih foto dari galeri/kamera statis lewat input file sementara
 * (fallback resmi plan §6). Resolve null bila pengguna membatalkan.
 */
export function pickFromGallery(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      resolve(file ?? null)
    })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve(null)
    })
    document.body.appendChild(input)
    input.click()
  })
}
