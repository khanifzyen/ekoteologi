<script setup lang="ts">
/**
 * Kartu streak (Sprint 5) — 1:1 pola `beranda.html`: lingkaran api, judul
 * "Streak N hari!", kalimat motivasi bonus, dan kalender 7 hari (hari ini
 * di-outline). Data dari `GET /v1/streak`; helper murni di `utils/streak.ts`.
 */
import { computed } from 'vue'

import type { StreakStatus } from '@/types/streak'
import { dayInitial, streakAriaLabel, streakHint, streakTitle } from '@/utils/streak'

const props = defineProps<{ streak: StreakStatus }>()

const title = computed(() => streakTitle(props.streak.current_streak))
const hint = computed(() =>
  streakHint({
    currentStreak: props.streak.current_streak,
    activeToday: props.streak.active_today,
    daysToBonus: props.streak.days_to_bonus,
    bonusPoints: props.streak.bonus_points,
    bonusEveryDays: props.streak.bonus_every_days,
  }),
)
const ariaLabel = computed(() => streakAriaLabel(props.streak.current_streak, props.streak.week))
</script>

<template>
  <div class="card streak-card">
    <div
      class="streak-flame"
      :class="{ cold: streak.current_streak <= 0 }"
      aria-hidden="true"
    >
      <i class="fas fa-fire" />
    </div>
    <div class="streak-info">
      <strong>{{ title }}</strong>
      <p>{{ hint }}</p>
    </div>
    <div
      class="streak-days"
      role="img"
      :aria-label="ariaLabel"
    >
      <span
        v-for="(day, index) in streak.week"
        :key="day.date"
        :class="{ on: day.active, today: index === streak.week.length - 1 }"
      >{{ dayInitial(day.date) }}</span>
    </div>
  </div>
</template>

<style scoped>
.streak-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.streak-flame {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--gold) 25%, var(--color-surface));
  color: var(--color-accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.streak-flame.cold {
  background: var(--surface-alt);
  color: var(--ink-300);
}
.streak-info {
  flex: 1;
  min-width: 0;
}
.streak-info strong {
  font-family: var(--font-heading);
  font-size: var(--text-sm);
}
.streak-info p {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: 2px;
}
.streak-days {
  display: flex;
  gap: 4px;
}
.streak-days span {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.streak-days span.on {
  background: var(--color-accent);
  color: var(--color-accent-fg);
}
.streak-days span.today {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
</style>
