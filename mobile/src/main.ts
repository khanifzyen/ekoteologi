import '@fontsource-variable/montserrat'
import '@fontsource-variable/open-sans'
import '@fontsource/amiri'
import '@fortawesome/fontawesome-free/css/all.min.css'

import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/app.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
