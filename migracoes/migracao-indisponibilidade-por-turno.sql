-- Indisponibilidade por turno: o voluntario bloqueia o dia todo ou so a
-- manha, a tarde ou a noite. O turno de um culto vem da hora de inicio:
-- antes das 12h e manha, ate as 18h e tarde, depois disso e noite.
--
-- Rode ANTES de publicar o app novo. Para desfazer: bloco no fim.

-- 1) coluna: vazia = dia todo; senao "manha", "tarde", "noite" separados por virgula
alter table public.indisponibilidades add column if not exists turnos text;
alter table public.indisponibilidades drop constraint if exists indisp_turnos_validos;
alter table public.indisponibilidades add constraint indisp_turnos_validos
  check (turnos is null or turnos ~ '^(manha|tarde|noite)(,(manha|tarde|noite))*$');

-- 2) regras usadas pelo banco
create or replace function public.turno_da_hora(p_hora time)
returns text language sql immutable as $$
  select case when p_hora < time '12:00' then 'manha'
              when p_hora < time '18:00' then 'tarde' else 'noite' end
$$;

create or replace function public.bloqueou(p_perfil uuid, p_data date, p_hora time)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from indisponibilidades i
                  where i.perfil_id = p_perfil and i.data = p_data
                    and (i.turnos is null
                         or turno_da_hora(coalesce(p_hora, time '19:00')) = any (string_to_array(i.turnos, ','))))
$$;

-- 3) assumir troca respeita o turno
create or replace function public.aceitar_troca(p_troca uuid)
 returns escalas language plpgsql security definer set search_path to 'public' as $function$
declare t trocas; a escalas; ev eventos; eu uuid; f funcoes;
begin
  eu := meu_perfil();
  if eu is null then raise exception 'sem sessao'; end if;

  select * into t from trocas where id = p_troca and status = 'aberta' for update;
  if not found then raise exception 'pedido nao esta mais aberto'; end if;

  select * into a from escalas where id = t.escala_id;
  select * into ev from eventos where id = a.evento_id;
  select * into f  from funcoes where id = a.funcao_id;

  if eu = a.perfil_id then raise exception 'voce ja e o escalado'; end if;
  if ev.data < current_date then raise exception 'culto ja passou'; end if;
  if not exists (select 1 from habilidades where perfil_id = eu and funcao_id = a.funcao_id)
    then raise exception 'voce nao exerce esta funcao'; end if;
  if exists (select 1 from ausencias where perfil_id = eu and ev.data between inicio and fim)
    then raise exception 'voce esta indisponivel nesta data'; end if;
  if bloqueou(eu, ev.data, ev.hora)
    then raise exception 'voce marcou que nao pode neste horario'; end if;
  if exists (select 1 from escalas where evento_id = a.evento_id and perfil_id = eu)
    then raise exception 'voce ja serve neste culto'; end if;

  update escalas set perfil_id = eu, status = 'confirmado', respondido_em = now()
   where id = a.id returning * into a;
  update trocas set status = 'aceita', aceita_por = eu, respondida_em = now() where id = t.id;

  insert into avisos (para_id, texto, tipo, ref)
  values (t.de_id, (select nome from perfis where id = eu)
          || ' assumiu a sua vaga de ' || f.nome || ' em ' || ev.titulo || '.', 'ok', t.id);

  insert into avisos (para_id, texto, tipo, ref)
  select p.id, (select nome from perfis where id = eu) || ' assumiu o lugar de '
         || (select nome from perfis where id = t.de_id) || ' em ' || ev.titulo || '.', 'ok', t.id
    from perfis p
   where p.igreja_id = minha_igreja() and p.id <> eu
     and ((p.perms ->> 'admin')::boolean is true or (p.perms ->> 'trocas')::boolean is true);

  update avisos set lido = true where ref = t.id and tipo = 'troca';
  return a;
end $function$;

-- 4) troca parada: conta quem pode assumir respeitando o turno
create or replace function public.trocas_paradas(p_dias integer default 2)
 returns table(troca_id uuid, perfil_id uuid, nome text, funcao text, evento text, data_txt text,
               dias_ate integer, dias_esperando integer, candidatos integer)
 language sql security definer set search_path to 'public' as $function$
  select
    t.id, p.id, p.nome, f.nome, ev.titulo, to_char(ev.data, 'DD/MM'),
    (ev.data - current_date)::int,
    (current_date - t.criada_em::date)::int,
    (select count(*)::int
       from perfis c
      where c.igreja_id = ev.igreja_id
        and c.id <> t.de_id
        and exists (select 1 from habilidades h
                     where h.perfil_id = c.id and h.funcao_id = e.funcao_id)
        and not exists (select 1 from escalas x
                         where x.evento_id = ev.id and x.perfil_id = c.id)
        and not bloqueou(c.id, ev.data, ev.hora)
        and not exists (select 1 from ausencias a
                         where a.perfil_id = c.id
                           and ev.data between a.inicio and a.fim))
  from trocas t
  join escalas e  on e.id  = t.escala_id
  join eventos ev on ev.id = e.evento_id
  join funcoes f  on f.id  = e.funcao_id
  join perfis  p  on p.id  = t.de_id
  where t.status = 'aberta'
    and t.alerta_parada is null
    and ev.data >= current_date
    and (current_date - t.criada_em::date >= p_dias
      or ev.data - current_date <= p_dias)
$function$;

-- 5) aviso de pedido de troca: so avisa quem pode naquele turno
create or replace function public.avisar_pedido_de_troca()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_esc escalas%rowtype; v_ev eventos%rowtype; v_fn funcoes%rowtype;
  v_de text; v_desc text; v_n int := 0;
begin
  if new.status is distinct from 'aberta' or new.permuta_de is not null then return new; end if;

  select * into v_esc from escalas where id = new.escala_id;
  if not found then return new; end if;
  select * into v_ev from eventos where id = v_esc.evento_id;
  select * into v_fn from funcoes where id = v_esc.funcao_id;
  select nome into v_de from perfis where id = new.de_id;
  v_desc := v_fn.nome || ' em ' || v_ev.titulo || ' (' || to_char(v_ev.data, 'DD/MM') || ')';

  if new.para_id is not null then
    insert into avisos (para_id, texto, tipo, ref)
    values (new.para_id, v_de || ' pediu que você assuma ' || v_desc || '.', 'troca', new.id);
    v_n := 1;
  else
    insert into avisos (para_id, texto, tipo, ref)
    select p.id, 'Vaga aberta para troca: ' || v_desc || '. ' || v_de || ' precisa de alguém.', 'troca', new.id
      from perfis p
      join habilidades h on h.perfil_id = p.id and h.funcao_id = v_esc.funcao_id
     where p.igreja_id = v_ev.igreja_id
       and p.id <> new.de_id
       and not exists (select 1 from escalas x where x.evento_id = v_ev.id and x.perfil_id = p.id)
       and not bloqueou(p.id, v_ev.data, v_ev.hora)
       and not exists (select 1 from ausencias a where a.perfil_id = p.id and v_ev.data between a.inicio and a.fim);
    get diagnostics v_n = row_count;
  end if;

  insert into avisos (para_id, texto, tipo, ref)
  select p.id,
         v_de || ' pediu troca de ' || v_desc || '.'
           || case when v_n = 0 then ' NINGUÉM da equipe pode assumir — precisa da sua ajuda.' else '' end,
         case when v_n = 0 then 'alerta' else 'troca' end,
         new.id
    from perfis p
   where p.igreja_id = v_ev.igreja_id
     and p.id <> new.de_id
     and (coalesce((p.perms->>'admin')::boolean, false)
          or coalesce((p.perms->>'trocas')::boolean, false)
          or coalesce((p.perms->>'escalas')::boolean, false))
     and (coalesce((p.perms->>'admin')::boolean, false)
          or coalesce(jsonb_array_length(case when jsonb_typeof(p.perms->'escopo') = 'array'
                                              then p.perms->'escopo' end), 0) = 0
          or (p.perms->'escopo') ? v_fn.equipe_id::text)
     and not exists (select 1 from avisos x where x.ref = new.id and x.para_id = p.id);

  return new;
end $$;

-- conferencia: deve devolver as duas linhas
select 'turnos' as o_que, column_name as nome from information_schema.columns
  where table_name = 'indisponibilidades' and column_name = 'turnos'
union all select 'regra', proname from pg_proc where proname = 'bloqueou';

/* ---------------- DESFAZER ----------------
-- (as funcoes voltam a olhar so o dia; rode de novo as versoes antigas se precisar)
alter table public.indisponibilidades drop constraint if exists indisp_turnos_validos;
alter table public.indisponibilidades drop column if exists turnos;
*/
