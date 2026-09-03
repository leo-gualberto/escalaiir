const CACHE = 'escala-v3';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

/* ---------- NOTIFICACOES ---------- */
/* O servidor manda um JSON: { titulo, corpo, url, tag }.
   Se vier texto solto ou vazio, ainda assim mostramos algo — no iOS a
   notificacao e OBRIGATORIA a cada push (userVisibleOnly), e ignorar o
   evento faz a Apple revogar a assinatura do aparelho. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { d = { corpo: e.data ? e.data.text() : '' }; }

  const titulo = d.titulo || 'Escala da Equipe';
  const opcoes = {
    body: d.corpo || 'Voce tem uma novidade na escala.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'escala',
    renotify: true,
    data: { url: d.url || './index.html' }
  };
  // a bolinha do ícone: o servidor manda quantos avisos a pessoa tem em
  // aberto, então o número fica certo mesmo com o app fechado
  const badge = typeof d.badge === 'number' ? d.badge : null;

  e.waitUntil((async () => {
    await self.registration.showNotification(titulo, opcoes);
    try {
      if (badge !== null && self.navigator && self.navigator.setAppBadge) {
        if (badge > 0) await self.navigator.setAppBadge(badge);
        else await self.navigator.clearAppBadge();
      }
    } catch (_) {}
  })());
});

/* Tocar na notificacao: reaproveita a janela aberta em vez de abrir outra. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) {
        if ('focus' in c) { c.navigate(destino).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(destino);
    })
  );
});

/* A assinatura pode expirar sozinha; o navegador avisa aqui.
   Reassinamos e guardamos para o app enviar ao servidor na proxima abertura. */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const antiga = e.oldSubscription || await self.registration.pushManager.getSubscription();
      const chave = antiga && antiga.options && antiga.options.applicationServerKey;
      if (!chave) return;
      const nova = await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: chave
      });
      const lista = await self.clients.matchAll({ includeUncontrolled: true });
      lista.forEach(c => c.postMessage({ tipo: 'push-renovado', assinatura: nova.toJSON() }));
    } catch (_) {}
  })());
});
