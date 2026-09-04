<script setup lang="ts">
/**
 * Chart batang komposisi kategori (Sprint 4) — port dari mockup
 * `admin/index.html`: batang nilai (persen), nilai di atas batang,
 * batang tertinggi memakai aksen gold.
 */
import { computed } from 'vue'

import { bars, niceMax, type PlotArea } from '@/utils/chart'

const props = withDefaults(
  defineProps<{
    labels: string[]
    values: number[]
    /** Teks utk aria-label SVG (deskriptif, dibaca pembaca layar). */
    description: string
    foot?: string
  }>(),
  { foot: '' },
)

const VIEW_W = 300
const VIEW_H = 210
const BAR_W = 44
const area = computed<PlotArea>(() => ({
  left: 20,
  right: VIEW_W - 15,
  top: 14,
  bottom: VIEW_H - 30,
}))

// Skala batang dipetakan ke 100% (komposisi) — maksimum tetap "cantik" bila data > 100.
const max = computed(() => Math.max(100, niceMax(Math.max(...props.values, 0))))
const geometry = computed(() => bars(props.values, BAR_W, area.value, max.value))
</script>

<template>
  <div class="chart-wrap">
    <svg
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      role="img"
      :aria-label="description"
    >
      <line
        class="axis"
        :x1="area.left"
        :x2="area.right"
        :y1="area.bottom"
        :y2="area.bottom"
      />
      <g aria-hidden="true">
        <rect
          v-for="(bar, i) in geometry"
          :key="`b${i}`"
          :class="i === 0 ? 'bar-accent' : 'bar'"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          rx="4"
        />
      </g>
      <text
        v-for="(bar, i) in geometry"
        :key="`v${i}`"
        class="bar-value fade-in"
        :class="`d${(i % 3) + 1}`"
        :x="bar.x + bar.width / 2"
        :y="bar.y - 6"
        text-anchor="middle"
      >{{ values[i] }}%</text>
      <text
        v-for="(bar, i) in geometry"
        :key="`l${i}`"
        class="bar-label"
        :x="bar.x + bar.width / 2"
        :y="area.bottom + 17"
        text-anchor="middle"
      >{{ labels[i] }}</text>
    </svg>
    <p
      v-if="foot"
      class="chart-foot"
    >
      {{ foot }}
    </p>
  </div>
</template>
