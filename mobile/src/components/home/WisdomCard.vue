<script setup lang="ts">
/**
 * Kartu wisdom "Kutipan Hari Ini" (Sprint 6) — 1:1 mockup `beranda.html`:
 * label, kutipan (font arab), sumber, dan baris "Aksi hari ini" + tombol
 * Bagikan (Web Share API bila ada — tap target 44px). Konten dari
 * `GET /v1/daily-content` (terjadwal admin atau fallback bank quote server).
 * Sprint 7: label kini prop — `beranda.html` "Kutipan Hari Ini",
 * `elearning.html` "Refleksi Hari Ini" (sumber data sama — satu endpoint).
 */
import { computed } from 'vue'

import type { DailyContent } from '@/types/daily'
import { canShare, contentTypeLabel, wisdomShareText } from '@/utils/daily'

const props = withDefaults(defineProps<{ content: DailyContent; label?: string }>(), {
  label: 'Kutipan Hari Ini',
})
const emit = defineEmits<{ share: [text: string] }>()

const typeLabel = computed(() => contentTypeLabel(props.content.type))
const shareText = computed(() => wisdomShareText(props.content))

function onShare() {
  if (canShare()) {
    void navigator
      .share({ title: `${props.label} — Ekoteologi AR`, text: shareText.value })
      .catch(() => {
        /* dibatalkan pengguna — bukan galat */
      })
    return
  }
  emit('share', shareText.value)
}
</script>

<template>
  <div class="card wisdom">
    <div class="wisdom-label">
      {{ label }}
    </div>
    <span
      class="chip chip-green wisdom-type"
      data-testid="wisdom-type"
    >{{ typeLabel }}</span>
    <blockquote data-testid="wisdom-body">
      "{{ content.body }}"
    </blockquote>
    <cite
      v-if="content.source"
      data-testid="wisdom-source"
    >
      — {{ content.source }}
    </cite>
    <div
      v-if="content.eco_action"
      class="wisdom-action"
    >
      <p>
        Aksi hari ini: <strong>{{ content.eco_action }}</strong>
      </p>
      <button
        class="share-btn"
        type="button"
        aria-label="Bagikan kutipan hari ini"
        @click="onShare"
      >
        <i
          class="fab fa-whatsapp"
          aria-hidden="true"
        />
        Bagikan
      </button>
    </div>
    <div
      v-else
      class="wisdom-action"
    >
      <p>Renungkan kutipan ini hari ini.</p>
      <button
        class="share-btn"
        type="button"
        aria-label="Bagikan kutipan hari ini"
        @click="onShare"
      >
        <i
          class="fab fa-whatsapp"
          aria-hidden="true"
        />
        Bagikan
      </button>
    </div>
  </div>
</template>

<style scoped>
.wisdom {
  position: relative;
  overflow: hidden;
  margin-bottom: var(--space-4);
}
.wisdom::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(
    color-mix(in srgb, var(--color-primary) 55%, transparent) 1px,
    transparent 1px
  );
  background-size: 18px 18px;
  opacity: 0.12;
  pointer-events: none;
}
.wisdom-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-primary);
  font-weight: 700;
  margin-bottom: 6px;
}
.wisdom-type {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
}
.wisdom blockquote {
  font-family: var(--font-arabic);
  font-style: italic;
  color: var(--color-heading);
  font-size: var(--text-md);
  line-height: 1.6;
  margin-bottom: 4px;
}
.wisdom cite {
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  display: block;
  margin-bottom: var(--space-3);
}
.wisdom-action {
  border-top: 1px dashed var(--color-border-strong);
  padding-top: var(--space-3);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}
.wisdom-action p {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.wisdom-action p strong {
  color: var(--color-accent-text);
}
.share-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-primary);
  font-weight: 700;
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}
</style>
