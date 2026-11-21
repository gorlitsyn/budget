import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { applyPrefs } from './prefs.ts';
import { setupPwa } from './pwa.ts';
import { router } from './router.ts';
import './styles/tokens.css';
import './styles/base.css';

applyPrefs();
setupPwa();
createApp(App).use(createPinia()).use(router).mount('#app');
