import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const ONBOARDED_KEY = 'ekoteologi_onboarded'

function onboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/onboarding',
      name: 'onboarding',
      component: () => import('@/views/OnboardingView.vue'),
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/scan',
      name: 'scan',
      component: () => import('@/views/ScanView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/riwayat',
      name: 'riwayat',
      component: () => import('@/views/HistoryView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/misi',
      name: 'misi',
      component: () => import('@/views/MissionsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/belajar',
      name: 'belajar',
      component: () => import('@/views/Elearning/ModuleListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/belajar/pelajaran/:lessonId',
      name: 'pelajaran',
      component: () => import('@/views/Elearning/LessonView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/belajar/modul/:moduleId/kuis',
      name: 'kuis',
      component: () => import('@/views/Elearning/QuizView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/belajar/modul/:moduleId/hasil',
      name: 'kuis-hasil',
      component: () => import('@/views/Elearning/ResultView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/belajar/modul/:moduleId',
      name: 'modul',
      component: () => import('@/views/Elearning/ModuleDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profil',
      name: 'profil',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return onboarded() ? { name: 'auth' } : { name: 'onboarding' }
  }
  // Yang sudah masuk tidak perlu melihat layar masuk/onboarding lagi.
  if ((to.name === 'auth' || to.name === 'onboarding') && auth.isAuthenticated) {
    return { name: 'home' }
  }
  return true
})

export default router
