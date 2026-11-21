import { createRouter, createWebHistory } from 'vue-router';
import CategoriesPage from './pages/CategoriesPage.vue';
import InvitePage from './pages/InvitePage.vue';
import LoginPage from './pages/LoginPage.vue';
import MorePage from './pages/MorePage.vue';
import PlanPage from './pages/PlanPage.vue';
import SharingPage from './pages/SharingPage.vue';
import SummaryPage from './pages/SummaryPage.vue';
import TransactionsPage from './pages/TransactionsPage.vue';
import ShoppingPage from './pages/ShoppingPage.vue';
import { useSession } from './stores/session.ts';
import { TABS } from './tabs.ts';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: () => firstTab() },
    { path: '/login', component: LoginPage, meta: { public: true, noTabs: true } },
    { path: '/invite/:token', component: InvitePage, props: true, meta: { public: true, noTabs: true } },
    { path: '/shopping', component: ShoppingPage },
    { path: '/transactions', component: TransactionsPage },
    { path: '/summary', component: SummaryPage },
    { path: '/plan', component: PlanPage },
    { path: '/more', component: MorePage },
    { path: '/more/sharing', component: SharingPage },
    { path: '/more/categories', component: CategoriesPage },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});

function firstTab(): string {
  const session = useSession();
  return TABS.find((t) => t.sections.length === 0 || t.sections.some((s) => session.can(s)))!.path;
}

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.loaded) await session.load();
  if (to.meta.public) return true;
  if (!session.me) return { path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } };
  const tab = TABS.find((t) => to.path.startsWith(t.path));
  if (tab && tab.sections.length && !tab.sections.some((s) => session.can(s))) return firstTab();
  return true;
});
