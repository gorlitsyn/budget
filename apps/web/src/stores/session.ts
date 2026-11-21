import { type Grants, type Me, type Section, type SharedSpace, OWNER_GRANTS, canEdit, canView } from '@money/shared';
import { defineStore } from 'pinia';
import { api } from '../api.ts';
import { readSpace, writeSpace } from '../prefs.ts';
import { clearDataCaches } from '../storage.ts';

interface MeResponse {
  me: Me | null;
  spaces: SharedSpace[];
  devLogin?: boolean;
}

/**
 * Кто вошёл и чьё пространство открыто. Своё пространство — id самого пользователя,
 * чужое — id владельца из spaces.
 */
export const useSession = defineStore('session', {
  state: () => ({
    me: null as Me | null,
    spaces: [] as SharedSpace[],
    devLogin: false,
    loaded: false,
    spaceId: null as string | null,
  }),
  getters: {
    isOwn: (s) => !s.me || s.spaceId === s.me.id,
    space: (s): SharedSpace | undefined => s.spaces.find((x) => x.ownerId === s.spaceId),
    grants(): Grants {
      return this.isOwn ? OWNER_GRANTS : (this.space?.grants ?? {});
    },
    spaceName(): string {
      return this.isOwn ? 'Моё' : (this.space?.ownerName ?? '');
    },
  },
  actions: {
    async load() {
      const r = await api<MeResponse>('/api/me');
      this.me = r.me;
      this.spaces = r.spaces;
      this.devLogin = r.devLogin ?? false;
      this.loaded = true;
      const saved = readSpace();
      const valid = (id: string | null) => !!id && (id === r.me?.id || r.spaces.some((s) => s.ownerId === id));
      this.spaceId = valid(this.spaceId) ? this.spaceId : valid(saved) ? saved : (r.me?.id ?? null);
    },
    switchSpace(id: string) {
      this.spaceId = id;
      writeSpace(id);
    },
    can(section: Section, level: 'view' | 'edit' = 'view'): boolean {
      return level === 'edit' ? canEdit(this.grants, section) : canView(this.grants, section);
    },
    async logout(everywhere = false) {
      await api(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' });
      clearDataCaches();
      this.$reset();
      this.loaded = true;
    },
  },
});
