const CACHE = 'escala-v6';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

/* ---------- ATUALIZACAO ----------
   Esta parte existe por causa de um sintoma concreto: a cada publicacao, o
   app instalado no iPhone parava de abrir e so voltava sendo adicionado de
   novo a tela de inicio.

   A causa era a versao nova assumir no meio do caminho: com skipWaiting() e
   clients.claim(), o service worker trocava enquanto a pagina rodava, e o
   activate ainda apagava o cache antigo debaixo dela. No navegador isso
   passa; no app instalado do iOS, que vive sendo congelado e restaurado,
   quebra.

   Agora a versao nova FICA ESPERANDO. Ela so assume quando nao ha mais
   nenhuma janela usando a antiga — ou quando a pessoa toca no aviso de
   "nova versao", que manda a mensagem 'assumir' daqui de baixo. Trocar de
   versao passa a ser uma decisao, nunca um susto. */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(
    /* 'reload' para o precache nao herdar uma copia velha do cache HTTP */
    FILES.map(f => new Request(f, { cache: 'reload' }))
  )));
  /* sem skipWaiting de proposito */
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.tipo === 'assumir') self.skipWaiting();   /* a pessoa pediu para atualizar */
});
/* Responder primeiro com o que está no cache e atualizar por baixo.
   Antes era o contrário: toda abertura esperava a rede, e no iPhone — que
   congela o app em segundo plano e o acorda com a rede ainda dormindo — essa
   espera aparecia como tela branca. Agora o app abre na hora, mesmo offline,
   e a versão nova entra na próxima abertura (o app avisa quando chega). */
const PRAZO_REDE = 6000;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.origin !== location.origin) return;   /* Supabase e afins passam direto */
  e.respondWith(responder(e.request));
});

async function responder(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req, { ignoreSearch: true });

  const daRede = fetch(req).then(async r => {
    if (r && r.ok) {
      const copia = r.clone();
      if (guardado && ehPagina(req)) avisarSeMudou(guardado.clone(), r.clone());
      cache.put(req, copia).catch(() => {});
    }
    return r;
  });

  if (guardado) { daRede.catch(() => {}); return guardado; }

  try { return await comPrazo(daRede, PRAZO_REDE); }
  catch (_) {
    const raiz = await cache.match('./index.html');
    return raiz || new Response('Sem conexão e sem cópia guardada.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

const ehPagina = req => req.mode === 'navigate' || /\/(index\.html)?(\?|$)/.test(new URL(req.url).pathname);

function comPrazo(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('a rede demorou')), ms))
  ]);
}

/* Só avisa quando o conteúdo mudou de verdade: um aviso a cada abertura
   ensinaria a equipe a ignorar o aviso. */
async function avisarSeMudou(antiga, nova) {
  try {
    const [a, b] = await Promise.all([antiga.text(), nova.text()]);
    if (a === b) return;
    const lista = await self.clients.matchAll({ includeUncontrolled: true });
    lista.forEach(c => c.postMessage({ tipo: 'nova-versao' }));
  } catch (_) {}
}

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
