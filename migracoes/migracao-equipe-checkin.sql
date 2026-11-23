-- Equipe de check-in: entrada e saida dos voluntarios, com hora e atraso
--
-- Quem tem a permissao "Fazer check-in dos voluntarios" pode marcar a
-- chegada e a saida de qualquer escalado da igreja, e nada mais na escala.
-- O voluntario nao marca a propria presenca. O banco registra quem marcou.
--
-- Rode ANTES de publicar o app novo. Para desfazer: bloco no fim.

-- 1) colunas: chegada, saida e quem registrou
alter table public.escalas add column if not exists chegou_em timestamptz;
alter table public.escalas add column if not exists saiu_em timestamptz;
alter table public.escalas add column if not exists presenca_por uuid;

-- 2) a equipe de check-in pode gravar na escala de qualquer pessoa da igreja
drop policy if exists es_checkin on public.escalas;
create policy es_checkin on public.escalas for update to authenticated
  using (pode('checkin') and evento_id in (select id from eventos where igreja_id = minha_igreja()))
  with check (evento_id in (select id from eventos where igreja_id = minha_igreja()));

-- 3) trava: presenca so muda pela equipe de check-in, e quem
--    so faz check-in nao muda mais nada na escala dos outros
create or replace function public.escalas_trava_presenca()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_eu uuid;
begin
  if auth.uid() is null then return new; end if;   -- funcoes do servidor (avisos)
  v_eu := meu_perfil();
  if not pode('checkin') then
    new.chegou_em := old.chegou_em;
    new.saiu_em := old.saiu_em;
    new.presenca_por := old.presenca_por;
  elsif new.chegou_em is distinct from old.chegou_em or new.saiu_em is distinct from old.saiu_em then
    new.presenca_por := v_eu;
  end if;
  if pode('checkin') and not pode('escalas') and old.perfil_id is distinct from v_eu
     and not exists (select 1 from trocas t where t.escala_id = old.id and t.status = 'aberta') then
    new.perfil_id := old.perfil_id; new.status := old.status; new.funcao_id := old.funcao_id;
    new.evento_id := old.evento_id; new.slot := old.slot; new.avisos := old.avisos;
    new.respondido_em := old.respondido_em;
  end if;
  return new;
end $$;

drop trigger if exists escalas_presenca on public.escalas;
create trigger escalas_presenca before update on public.escalas
  for each row execute function public.escalas_trava_presenca();

-- conferencia: deve devolver as quatro linhas
select 'saida' as o_que, column_name as nome from information_schema.columns
  where table_name = 'escalas' and column_name = 'saiu_em'
union all select 'quem registrou', column_name from information_schema.columns
  where table_name = 'escalas' and column_name = 'presenca_por'
union all select 'permissao', policyname from pg_policies where policyname = 'es_checkin'
union all select 'trava', tgname from pg_trigger where tgname = 'escalas_presenca';

/* ---------------- DESFAZER ----------------
drop trigger if exists escalas_presenca on public.escalas;
drop function if exists public.escalas_trava_presenca();
drop policy if exists es_checkin on public.escalas;
alter table public.escalas drop column if exists saiu_em;
alter table public.escalas drop column if exists presenca_por;
*/
