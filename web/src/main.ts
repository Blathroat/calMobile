import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/app/App.vue';
import { router } from '@/app/router';

createApp(App)
  .use(createPinia())
  .use(router)
  .mount('#app');
