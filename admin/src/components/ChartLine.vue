<script setup lang="ts">
/**
 * Chart garis gaya editorial (Sprint 4) — port dari SVG mockup
 * `admin/index.html`: gridline halus, 4 tick, area tipis, garis utama
 * (animasi draw otomatis mati pada prefers-reduced-motion via admin.css),
 * titik aksen + anotasi pada nilai maksimum.
 */
import { computed } from 'vue'

import {
  areaPath,
  linePath,
  linePoints,
  maxIndex,
  niceMax,
  scaleY,
  ticks,
  xPositions,
  type PlotArea,
} from '@/utils/chart'

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

const VIEW_W = 560
const VIEW_H = 240
const area = computed<PlotArea>(() => ({
  left: 40,
  right: VIEW_W - 10,
  top: 10,
  bottom: VIEW_H - 20,
}))

const max = computed(() => niceMax(Math.max(...props.values, 0)))
const tickValues = computed(() => ticks(max.value))
const points = computed(() => linePoints(props.values, area.value))
const line = computed(() => linePath(points.value))
const fill = computed(() => areaPath(points.value, area.value))
const xs = computed(() => xPositions(props.values.length, area.value))
const peak = computed(() => {
  if (props.values.length === 0) return null
  const idx = maxIndex(props.values)
  return { x: xs.value[idx], y: points.value[idx]?.y, value: props.values[idx], label: props.labels[idx] }
})
// Ticks label sumbu-x: maksimal 4 label agar tetap terbaca.
const xLabelIdx = computed(() => {
  const count = props.labels.length
  if (count === 0) return []
  const picks = new Set<number>([0, count - 1])
  if (count > 4) {
    picks.add(Math.floor((count - 1) / 3))
    picks.add(Math.floor(((count - 1) * 2) / 3))
  } else if (count > 2) {
    picks.add(Math.floor((count - 1) / 2))
  }
  return [...picks].sort((a, b) => a - b)
})
</script>

<template>
  <div class="chart-wrap">
    <svg
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      role="img"
      :aria-label="description"
    >
      <g aria-hidden="true">
        <line
          v-for="(t, i) in tickValues"
          :key="`g${i}`"
          class="gridline"
          :x1="area.left"
          :x2="area.right"
          :y1="scaleY(t, max, area)"
          :y2="scaleY(t, max, area)"
        />
        <line
          class="axis"
          :x1="area.left"
          :x2="area.left"
          :y1="area.top - 2"
          :y2="area.bottom"
        />
        <text
          v-for="(t, i) in tickValues"
          :key="`ty${i}`"
          class="tick-label"
          :x="area.left - 6"
          :y="scaleY(t, max, area) + 3.5"
          text-anchor="end"
        >{{ t }}</text>
        <text
          v-for="i in xLabelIdx"
          :key="`tx${i}`"
          class="tick-label"
          :x="xs[i]"
          :y="area.bottom + 16"
          :text-anchor="i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'"
        >{{ labels[i] }}</text>
      </g>
      <path
        class="area-fill fade-in d2"
        :d="fill"
      />
      <path
        class="line-main draw"
        :d="line"
      />
      <circle
        v-if="points[0]"
        class="dot"
        :cx="points[0].x"
        :cy="points[0].y"
        r="3.5"
      />
      <template v-if="peak && peak.y !== undefined">
        <circle
          class="dot-accent"
          :cx="peak.x"
          :cy="peak.y"
          r="5"
        />
        <text
          class="annot fade-in d3"
          :x="Math.min(peak.x + 6, area.right)"
          :y="Math.max(peak.y - 10, 10)"
          text-anchor="end"
        >{{ peak.label }} · {{ peak.value }} scan</text>
      </template>
    </svg>
    <p
      v-if="foot"
      class="chart-foot"
    >
      {{ foot }}
    </p>
  </div>
</template>
