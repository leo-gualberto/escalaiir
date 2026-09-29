-- ============================================================
-- Time de Intercessão: a igreja e as duas lideranças
--
-- Pré-requisito: migracao-multi-igreja.sql já rodado (isolamento entre igrejas).
--
-- Pode rodar mais de uma vez: cria a igreja só se ela ainda não existir e
-- insere apenas as pessoas que ainda não estiverem lá. O resultado traz o
-- CÓDIGO DE ACESSO de cada uma — é com ele que entram no mesmo endereço do
-- app e encontram um espaço vazio, sem nada do time técnico.
-- ============================================================

with existente as (
  select id from public.igrejas where nome = 'Intercessão' order by criada_em limit 1
),
criada as (
  insert into public.igrejas (nome, vapid_public)
  select 'Intercessão',
         -- mesma chave de notificação das outras: o disparo é do mesmo servidor
         (select vapid_public from public.igrejas
           where vapid_public is not null order by criada_em limit 1)
  where not exists (select 1 from existente)
  returning id
),
ig as (
  select id from existente
  union all
  select id from criada
),
lideres(nome, email) as (
  values ('Stephanie Gama de Oliveira', 'sgo.advogada@hotmail.com'),
         ('João Vitor Almeida Marques', 'joaovitor.kenia@gmail.com')
)
insert into public.perfis (igreja_id, nome, email, perms)
select ig.id, l.nome, l.email, '{"admin": true}'::jsonb
  from ig, lideres l
 where not exists (
   select 1 from public.perfis p where p.igreja_id = ig.id and p.email = l.email
 )
returning nome as lider, email, codigo as codigo_de_acesso;
