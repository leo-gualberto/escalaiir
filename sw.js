const CACHE = 'escala-v7';
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
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async f => {
      try {
        /* 'reload' para o precache nao herdar uma copia velha do cache HTTP */
        const r = await fetch(new Request(f, { cache: 'reload' }));
        await guardar(cache, f, r);
      } catch (_) {}
    }));
    /* Assume sempre. A versao anterior esperava todas as janelas fecharem, e
       isso criou um impasse real: quando o service worker no comando esta
       quebrado, a unica janela aberta e a da mensagem de erro — entao a
       correcao nunca entrava em vigor. Assumir aqui NAO mexe em quem ja esta
       com uma tela aberta: sem clients.claim(), cada pagina so passa para a
       versao nova no proximo carregamento, que e navegacao nova e nao tem
       tela para quebrar. */
    await self.skipWaiting();
  })());
});

/* ---------- RESPOSTA SEM REDIRECIONAMENTO ----------
   O navegador RECUSA uma resposta redirecionada para uma navegacao servida
   por service worker — no Safari isso apareceu como "Response served by
   service worker has redirections" e o app simplesmente nao abria. Acontece
   porque "/" responde com um desvio para "/index.html": a resposta carrega a
   marca de redirecionada, e guardar essa copia no cache contamina todas as
   aberturas seguintes.
   Remontar a resposta a partir do corpo tira a marca. */
async function semDesvio(res) {
  if (!res || !res.redirected) return res;
  const corpo = await res.blob();
  return new Response(corpo, {
    status: res.status, statusText: res.statusText, headers: res.headers
  });
}
async function guardar(cache, chave, res) {
  if (!res || !res.ok) return res;
  const limpa = await semDesvio(res.clone());
  await cache.put(chave, limpa.clone()).catch(() => {});
  return limpa;
}

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    /* Apagar o cache antigo com alguem usando a versao antiga foi exatamente
       o que deixou o app do iPhone em branco: a pagina continuava pedindo
       arquivos de um cache que tinha acabado de sumir. Com janela aberta, o
       cache velho fica mais uma rodada; ele sai na proxima ativacao, quando
       ninguem mais depender dele. */
    const janelas = await self.clients.matchAll({ type: 'window' });
    if (!janelas.length) {
      const ks = await caches.keys();
      await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    }
    /* sem clients.claim(): cada pagina adota a versao nova no proximo
       carregamento, nunca no meio de uma tela aberta */
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
    if (!r || !r.ok) return r;
    if (guardado && ehPagina(req)) avisarSeMudou(guardado.clone(), r.clone());
    return await guardar(cache, req, r);
  });

  if (guardado) { daRede.catch(() => {}); return await semDesvio(guardado); }

  try { return await semDesvio(await comPrazo(daRede, PRAZO_REDE)); }
  catch (_) {
    const raiz = await cache.match('./index.html');
    if (raiz) return await semDesvio(raiz);
    return new Response('Sem conexão e sem cópia guardada.', {
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
