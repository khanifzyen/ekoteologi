<script setup lang="ts">
/** Kartu KPI dashboard admin — acuan `.panel.kpi` mockup `admin/index.html`. */

withDefaults(
  defineProps<{
    icon: string
    label: string
    value: string
    /** Teks delta kecil di bawah nilai (mis. "+3 vs minggu lalu"). */
    delta?: string
    /** Arah delta: hanya memengaruhi warna ikon/teks (token). */
    tone?: 'up' | 'down' | 'neutral'
  }>(),
  { delta: '', tone: 'neutral' },
)
</script>

<template>
  <div class="panel kpi">
    <div class="ic">
      <i
        class="fas"
        :class="icon"
        aria-hidden="true"
      />
    </div>
    <div>
      <div class="lbl">
        {{ label }}
      </div>
      <div class="val num">
        {{ value }}
      </div>
      <div
        v-if="delta"
        class="delta"
        :class="tone"
      >
        <i
          class="fas"
          :class="tone === 'down' ? 'fa-minus' : 'fa-arrow-trend-up'"
          aria-hidden="true"
        />
        {{ delta }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.delta.neutral {
  color: var(--color-text-muted);
}
</style>
