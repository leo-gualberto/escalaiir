-- ============================================================
-- Informações do culto (recado da liderança + links)
-- Rode este script no SQL Editor do Supabase ANTES de publicar
-- a versão 1.2 do app. Sem ele, a sincronização da tabela
-- "eventos" para de funcionar (coluna inexistente).
-- ============================================================

alter table public.eventos
  add column if not exists obs   text,
  add column if not exists links jsonb not null default '[]'::jsonb;

comment on column public.eventos.obs   is 'Recado livre da liderança, visível para todos os escalados';
comment on column public.eventos.links is 'Lista de links [{titulo,url}] mostrada na tela do culto';

-- Conferência rápida: deve devolver as duas colunas
select column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name='eventos'
   and column_name in ('obs','links');
