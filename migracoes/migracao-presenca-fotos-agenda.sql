-- Presenca no dia, foto dos colegas, desligar a agenda e aviso de quem nao confirmou
--
-- Rode ANTES de publicar o app novo. O app so liga cada recurso quando o
-- banco ja tem o que ele precisa, entao a ordem errada nao quebra nada.
-- Para desfazer: bloco no fim.

-- 1) Lider avisado de quem nao confirmou, 2 dias antes, as 9h12 de Brasilia.
--    Cada lider recebe so as pessoas das equipes dele. O aviso entra na fila
--    normal e o celular toca em ate 1 minuto.
create or replace function public.avisar_nao_confirmados(p_dias int default 2)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  with pend as (
    select ev.id ev_id, ev.igreja_id, ev.titulo, ev.data, f.equipe_id, p.id pid,
           split_part(p.nome, ' ', 1) nome
      from escalas e
      join eventos ev on ev.id = e.evento_id
      join funcoes f on f.id = e.funcao_id
      join perfis p on p.id = e.perfil_id
     where ev.data = current_date + p_dias
       and e.status is distinct from 'confirmado'
  ), por_lider as (
    select l.id lider, pd.ev_id, pd.titulo, pd.data,
           array_agg(distinct pd.nome) nomes, count(distinct pd.pid) n
      from pend pd
      join perfis l on l.igreja_id = pd.igreja_id
     where (coalesce((l.perms->>'admin')::boolean, false)
            or coalesce((l.perms->>'escalas')::boolean, false))
       and (coalesce((l.perms->>'admin')::boolean, false)
            or coalesce(jsonb_array_length(case when jsonb_typeof(l.perms->'escopo') = 'array'
                                                then l.perms->'escopo' end), 0) = 0
            or (l.perms->'escopo') ? pd.equipe_id::text)
       and not exists (select 1 from avisos x where x.para_id = l.id and x.ref = pd.ev_id
                          and x.tipo = 'alerta' and x.texto like '%confirm%')
     group by l.id, pd.ev_id, pd.titulo, pd.data
  )
  insert into avisos (para_id, texto, tipo, ref)
  select lider,
         titulo || ' (' || to_char(data, 'DD/MM') || '): '
           || case when n = 1 then '1 pessoa ainda não confirmou: '
                   else n || ' pessoas ainda não confirmaram: ' end
           || array_to_string(nomes[1:6], ', ')
           || case when n > 6 then ' e mais ' || (n - 6) else '' end
           || '. Abra o culto para cobrar.',
         'alerta', ev_id
    from por_lider;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.avisar_nao_confirmados(int) from public, anon, authenticated;

select cron.schedule('push-nao-confirmados', '12 12 * * *',
  $$select public.avisar_nao_confirmados(2)$$);

-- 2) Foto dos colegas: o voluntario passa a receber a foto junto com o nome
alter table public.perfis add column if not exists foto text;
create or replace view public.pessoas_publicas as
  select id, igreja_id, nome, foto from perfis where igreja_id = minha_igreja();

-- 3) Presenca no dia: a hora em que a pessoa marcou "Cheguei"
alter table public.escalas add column if not exists chegou_em timestamptz;

-- 4) Desligar a agenda: apaga o endereco; o calendario do aparelho para de atualizar
create or replace function public.desligar_agenda()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if meu_perfil() is null then return false; end if;
  delete from agendas where perfil_id = meu_perfil();
  return true;
end $$;
revoke all on function public.desligar_agenda() from public, anon;
grant execute on function public.desligar_agenda() to authenticated;

-- conferencia: deve devolver as quatro linhas
select 'aviso 2 dias antes' as o_que, jobname as nome from cron.job where jobname = 'push-nao-confirmados'
union all select 'foto dos colegas', column_name from information_schema.columns
  where table_name = 'pessoas_publicas' and column_name = 'foto'
union all select 'presenca', column_name from information_schema.columns
  where table_name = 'escalas' and column_name = 'chegou_em'
union all select 'desligar agenda', proname from pg_proc where proname = 'desligar_agenda';

/* ---------------- DESFAZER ----------------
select cron.unschedule('push-nao-confirmados');
drop function if exists public.avisar_nao_confirmados(int);
create or replace view public.pessoas_publicas as
  select id, igreja_id, nome, foto from perfis where igreja_id = minha_igreja();
  -- (para tirar a foto da visao: drop view e recriar so com id, igreja_id, nome)
alter table public.escalas drop column if exists chegou_em;
drop function if exists public.desligar_agenda();
*/
