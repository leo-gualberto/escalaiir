# Escala da Equipe

App de escala de voluntários dos ministérios da igreja (PWA de arquivo único).

- **Produção:** https://tecnica.escalaiir.com (também em escalaiir.netlify.app)
- **Stack:** HTML/CSS/JS em arquivo único (`index.html`), PWA com service worker (`sw.js`), backend Supabase.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O app inteiro: estilos, telas e lógica |
| `sw.js` | Service worker: cache offline e notificações push |
| `manifest.webmanifest` | Manifesto do PWA |
| `icon-192.png`, `icon-512.png` | Ícones do app |

## Migrações do banco

O app fala direto com o Supabase. Quando uma versão passa a gravar uma coluna nova,
o script correspondente em `migracoes/` precisa rodar no SQL Editor **antes** do deploy —
senão a sincronização daquela tabela para. O próprio app avisa em
**Perfil → Diagnóstico da nuvem** qual script está faltando.

| Script | O que adiciona |
|---|---|
| `migracoes/migracao-info-culto.sql` | `eventos.obs` e `eventos.links` — a área de informações do culto (v1.2) |

## Deploy

Dois destinos, ambos a partir da branch `main` deste repositório, sem etapa de build:

| Endereço | Onde | Como |
|---|---|---|
| `tecnica.escalaiir.com` | Cloudflare Worker `wispy-base-2c74` (só arquivos estáticos) | Workers Builds: cada push roda `npx wrangler deploy` com a configuração de `wrangler.jsonc` |
| `escalaiir.netlify.app` | Netlify (projeto `escalaiir`) | Deploy contínuo do `main`, sem build command, publish na raiz |

O `.assetsignore` mantém README, migrações e metadados do Git fora do site publicado.

## Histórico

Este repositório foi criado a partir do código publicado em produção (setembro/2026).
