import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/app/App.vue';
import { router } from '@/app/router';
import { bootApp } from '@/app/runtime';
import '@/styles/migration.css';
import '@/styles/tokens.css';
import '@/styles/motion.css';

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app');

void bootApp().catch((error: unknown) => {
  console.error('bootstrap failed', error);
});
