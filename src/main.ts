import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { useSession } from './stores/session'
import './styles/main.css'

const app = createApp(App).use(createPinia()).use(router).use(i18n)
useSession().keepPresence()
app.mount('#app')
