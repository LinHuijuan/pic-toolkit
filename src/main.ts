import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initPwa } from './composables/pwa'

// 注册 Service Worker 并监听更新（"有新版 → 点击刷新"），离线就绪也在此提示
if ('serviceWorker' in navigator) {
  initPwa()
}

createApp(App).mount('#app')
