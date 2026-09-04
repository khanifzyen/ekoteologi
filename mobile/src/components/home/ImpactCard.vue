<script setup lang="ts">
/**
 * Kartu dampak "Pohon Kebaikanmu" (Sprint 6) — 1:1 mockup `beranda.html`:
 * visual pohon (lingkaran radial), nama tahap + mikrokonteks, pbar ARIA,
 * dan hitungan total aksi nyata. Tahap dihitung `utils/impact.ts` dari
 * scan bernilai poin + misi disetujui (`GET /v1/profile`, Sprint 6).
 */
import { computed } from 'vue'

import { impactAriaLabel, impactStage } from '@/utils/impact'

const props = defineProps<{ totalActions: number }>()

const stage = computed(() => impactStage(props.totalActions))
const aria = computed(() => impactAriaLabel(stage.value))
</script>

<template>
  <div
    class="card impact-card"
    data-testid="impact-card"
  >
    <div
      class="tree-visual"
      aria-hidden="true"
    >
      <i class="fas fa-tree" />
    </div>
    <div class="impact-info">
      <h3>Pohon Kebaikanmu</h3>
      <p data-testid="impact-hint">
        {{ stage.hint }}
      </p>
      <div
        class="pbar"
        role="progressbar"
        :aria-valuenow="stage.percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="aria"
      >
        <div
          class="pbar-fill green"
          :style="{ width: `${stage.percent}%` }"
        />
      </div>
    </div>
    <div class="impact-count">
      <strong data-testid="impact-count">{{ totalActions }}</strong>
      <span>aksi nyata</span>
    </div>
  </div>
</template>

<style scoped>
.impact-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.tree-visual {
  width: 64px;
  height: 64px;
  flex: none;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--color-primary-soft), var(--color-bg));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
  font-size: 28px;
  border: 1px solid var(--color-border);
}
.impact-info {
  flex: 1;
}
.impact-info h3 {
  font-size: var(--text-md);
  margin-bottom: 2px;
}
.impact-info p {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-2);
}
.impact-info .pbar {
  margin-top: 2px;
}
.impact-count {
  text-align: center;
  flex: none;
}
.impact-count strong {
  display: block;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-lg);
  color: var(--color-primary-strong);
}
.impact-count span {
  font-size: 10px;
  color: var(--color-text-muted);
}
</style>
