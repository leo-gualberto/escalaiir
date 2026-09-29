-- ============================================================
-- Criar uma igreja/time NOVO, isolado dos que já existem
--
-- Pré-requisito: migracao-multi-igreja.sql já rodado.
--
-- Como usar: edite as três linhas de "dados" abaixo e rode no SQL Editor.
-- O resultado traz o CÓDIGO DE ACESSO de 6 letras do líder — é com ele que
-- a pessoa entra no mesmo endereço do app e encontra um app vazio, só dela.
-- ============================================================

with dados as (
  select 'Intercessão'::text        as igreja,   -- nome que aparece no topo do app
         'Nome do Líder'::text      as lider,    -- quem vai administrar esse time
         'email@exemplo.com'::text  as email     -- e-mail do líder
),
nova as (
  insert into public.igrejas (nome, vapid_public)
  select d.igreja,
         -- mesma chave de notificação das demais: o disparo é do mesmo servidor
         (select vapid_public from public.igrejas where vapid_public is not null
           order by criada_em limit 1)
  from dados d
  returning id
)
insert into public.perfis (igreja_id, nome, email, perms)
select nova.id, d.lider, d.email, '{"admin": true}'::jsonb
from nova, dados d
returning nome as lider, codigo as codigo_de_acesso;
