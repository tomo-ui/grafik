/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

/** Baza aplikacji: „/” lokalnie, „/grafik/” na GitHub Pages. */
const BASE = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;

/** Cache, w którym dzielone z Androida zdjęcie czeka na odebranie przez aplikację. */
export const SHARE_CACHE = 'grafik-share';
export const SHARED_KEY = '/__shared-image';

// P-09: precache z rewizjami — deploy zawsze daje spójny zestaw plików; skipWaiting dopiero po akceptacji
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), {
    // BASE zawiera tylko litery, cyfry, „-”, „_” i „/”; kropkę w nazwie repozytorium też eskejpujemy
    denylist: [new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(share-target|api/)`)],
  }),
);

// AI i proxy zawsze przez sieć (nigdy z cache)
registerRoute(
  ({ url }) =>
    url.hostname === 'generativelanguage.googleapis.com' || url.pathname.startsWith(`${BASE}api/`),
  new NetworkOnly(),
);

/**
 * Android: udostępnienie zdjęcia z galerii do aplikacji (manifest `share_target`, POST multipart).
 * Zapisujemy plik w Cache API i przekierowujemy na /?action=shared — aplikacja otwiera skanowanie.
 */
registerRoute(
  ({ url }) => url.pathname === `${BASE}share-target`,
  async ({ request }) => {
    try {
      const form = await request.formData();
      const file = form.get('image');
      if (file instanceof File && file.type.startsWith('image/')) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(
          SHARED_KEY,
          new Response(file, {
            headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
          }),
        );
        return Response.redirect(`${BASE}?action=shared`, 303);
      }
    } catch {
      /* uszkodzone żądanie — wracamy na ekran główny */
    }
    return Response.redirect(BASE, 303);
  },
  'POST',
);

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING')
    void self.skipWaiting();
});
clientsClaim();
