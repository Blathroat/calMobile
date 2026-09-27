/** 跨页面会话状态，服务端仍是身份与权限的最终权威。 */
import { t } from '@/i18n';
import { defineStore } from 'pinia';
import type { User } from '@/api/types';

export interface SessionState {
  loggedIn: boolean;
  guest: boolean;
  user: User;
}

const emptyUser = (): User => ({ role: 'guest', roleLabel: t('s_h6o1xg'), can: {} });

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({ loggedIn: false, guest: true, user: emptyUser() }),
  getters: {
    role: (state) => String(state.user.role ?? 'guest'),
    limited: (state) => state.user.can?.limited === true,
    can: (state) => (capability: string) => state.user.can?.[capability] !== false,
  },
  actions: {
    applyUser(user: User = {}) {
      this.user = { ...emptyUser(), ...user };
      this.loggedIn = user.loggedIn === true || user.id !== undefined;
      this.guest = user.guest !== false && !this.loggedIn;
    },
    clear() {
      this.loggedIn = false;
      this.guest = true;
      this.user = emptyUser();
    },
  },
});
