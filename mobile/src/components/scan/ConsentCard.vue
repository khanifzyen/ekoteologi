<script setup lang="ts">
/**
 * Kartu persetujuan foto (PRD §9) — reusable: layar Scan (Sprint 3) dan
 * unggah bukti misi (Sprint 4). Wajib disetujui sebelum foto diunggah.
 */
withDefaults(
  defineProps<{
    title?: string
    description?: string
    agreeLabel?: string
    cancelLabel?: string
  }>(),
  {
    title: 'Izin Penggunaan Foto',
    description:
      'Sebelum mulai, kami perlu izinmu memakai foto untuk fitur scan.',
    agreeLabel: 'Setuju & Lanjutkan',
    cancelLabel: 'Nanti Saja',
  },
)

defineEmits<{ agree: []; cancel: [] }>()
</script>

<template>
  <div
    class="permission"
    role="dialog"
    aria-modal="true"
    aria-labelledby="consentTitle"
  >
    <div class="perm-card consent-card">
      <div class="perm-icon perm-icon-gold">
        <i
          class="fas fa-shield-heart"
          aria-hidden="true"
        />
      </div>
      <h2 id="consentTitle">
        {{ title }}
      </h2>
      <p>{{ description }}</p>
      <ul class="consent-points">
        <li>
          <i
            class="fas fa-cloud-arrow-up"
            aria-hidden="true"
          />
          Foto diunggah ke server dan dianalisis AI untuk menentukan jenis sampah.
        </li>
        <li>
          <i
            class="fas fa-clock-rotate-left"
            aria-hidden="true"
          />
          Foto tersimpan di riwayat scan milikmu dan tidak dibagikan ke pengguna lain.
        </li>
        <li>
          <i
            class="fas fa-hand-holding-heart"
            aria-hidden="true"
          />
          Foto dapat dihapus atas permintaanmu (retensi &amp; penghapusan — PRD §9).
        </li>
      </ul>
      <button
        class="btn btn-primary"
        type="button"
        @click="$emit('agree')"
      >
        <i
          class="fas fa-check"
          aria-hidden="true"
        />
        {{ agreeLabel }}
      </button>
      <button
        class="btn btn-secondary"
        type="button"
        @click="$emit('cancel')"
      >
        {{ cancelLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.permission {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--ink-900) 70%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  overscroll-behavior: contain;
}
.perm-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  padding: var(--space-6) var(--space-5);
  text-align: center;
  max-width: 320px;
  width: 100%;
}
.perm-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto var(--space-4);
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.perm-icon-gold {
  background: color-mix(in srgb, var(--gold) 25%, var(--color-surface));
  color: var(--color-accent-text);
}
.perm-card h2 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  color: var(--color-heading);
  margin-bottom: 6px;
}
.perm-card p {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
}
.consent-points {
  text-align: left;
  list-style: none;
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}
.consent-points li {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  font-size: var(--text-xs);
  color: var(--color-text);
  line-height: var(--lh-snug);
}
.consent-points i {
  color: var(--color-primary);
  margin-top: 2px;
}
.consent-card .btn + .btn {
  margin-top: var(--space-3);
}
</style>
