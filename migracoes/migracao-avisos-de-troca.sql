-- Avisos de troca criados pelo banco
--
-- O problema: quem criava os avisos de um pedido de troca era o celular de
-- quem pedia. O celular de um voluntario nao conhece as funcoes dos colegas
-- nem quem e lider (privacidade), entao pedido "para toda a equipe" feito por
-- voluntario nao avisava ninguem, e o lider nunca ficava sabendo. Em 67
-- pedidos de troca, so 1 aviso tinha sido criado.
--
-- A correcao: o proprio banco cria os avisos quando o pedido entra, porque
-- so ele ve tudo. A funcao de envio ja manda esses avisos para o celular.
--
-- Rode ANTES de publicar o app novo. Para desfazer: bloco no fim.

-- 1) Pedido de troca novo -> avisa quem pode assumir e a lideranca
create or replace function public.avisar_pedido_de_troca()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_esc escalas%rowtype; v_ev eventos%rowtype; v_fn funcoes%rowtype;
  v_de text; v_desc text; v_n int := 0;
begin
  -- so pedido aberto e comum; a permuta (troca casada) o app ja avisa
  if new.status is distinct from 'aberta' or new.permuta_de is not null then return new; end if;

  select * into v_esc from escalas where id = new.escala_id;
  if not found then return new; end if;
  select * into v_ev from eventos where id = v_esc.evento_id;
  select * into v_fn from funcoes where id = v_esc.funcao_id;
  select nome into v_de from perfis where id = new.de_id;
  v_desc := v_fn.nome || ' em ' || v_ev.titulo || ' (' || to_char(v_ev.data, 'DD/MM') || ')';

  if new.para_id is not null then
    -- pedido direto para uma pessoa
    insert into avisos (para_id, texto, tipo, ref)
    values (new.para_id, v_de || ' pediu que você assuma ' || v_desc || '.', 'troca', new.id);
    v_n := 1;
  else
    -- pedido aberto: quem tem a funcao, nao esta nesse culto e nao bloqueou a data
    insert into avisos (para_id, texto, tipo, ref)
    select p.id, 'Vaga aberta para troca: ' || v_desc || '. ' || v_de || ' precisa de alguém.', 'troca', new.id
      from perfis p
      join habilidades h on h.perfil_id = p.id and h.funcao_id = v_esc.funcao_id
     where p.igreja_id = v_ev.igreja_id
       and p.id <> new.de_id
       and not exists (select 1 from escalas x where x.evento_id = v_ev.id and x.perfil_id = p.id)
       and not exists (select 1 from indisponibilidades i where i.perfil_id = p.id and i.data = v_ev.data)
       and not exists (select 1 from ausencias a where a.perfil_id = p.id and v_ev.data between a.inicio and a.fim);
    get diagnostics v_n = row_count;
  end if;

  -- lideranca: quem aprova trocas ou monta escalas, respeitando o lider por
  -- equipe; quem ja recebeu aviso deste pedido nao recebe outro
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

drop trigger if exists trocas_avisar on public.trocas;
create trigger trocas_avisar after insert on public.trocas
  for each row execute function public.avisar_pedido_de_troca();

-- 2) Avisar a lideranca a partir do app (troca aceita, permuta, datas
--    bloqueadas...). Pelo mesmo motivo: o celular do voluntario nao sabe quem
--    e lider. Chamado com p_texto nulo, so responde 0 -- o app usa isso para
--    saber se esta migracao ja rodou.
create or replace function public.avisar_lideres(
  p_texto text, p_tipo text default 'info', p_ref uuid default null,
  p_equipes uuid[] default null, p_exceto uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if p_texto is null or minha_igreja() is null then return 0; end if;
  insert into avisos (para_id, texto, tipo, ref)
  select p.id, left(p_texto, 500), coalesce(p_tipo, 'info'), p_ref
    from perfis p
   where p.igreja_id = minha_igreja()
     and p.id is distinct from p_exceto
     and p.id is distinct from meu_perfil()
     and (coalesce((p.perms->>'admin')::boolean, false)
          or coalesce((p.perms->>'trocas')::boolean, false)
          or coalesce((p.perms->>'escalas')::boolean, false))
     and (coalesce((p.perms->>'admin')::boolean, false)
          or coalesce(jsonb_array_length(case when jsonb_typeof(p.perms->'escopo') = 'array'
                                              then p.perms->'escopo' end), 0) = 0
          or p_equipes is null
          or exists (select 1 from unnest(p_equipes) e where (p.perms->'escopo') ? e::text));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.avisar_lideres(text, text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.avisar_lideres(text, text, uuid, uuid[], uuid) to authenticated;

-- conferencia: deve devolver as duas linhas
select 'gatilho' as o_que, tgname as nome from pg_trigger where tgname = 'trocas_avisar'
union all
select 'funcao', proname from pg_proc where proname = 'avisar_lideres';

/* ---------------- DESFAZER ----------------
drop trigger if exists trocas_avisar on public.trocas;
drop function if exists public.avisar_pedido_de_troca();
drop function if exists public.avisar_lideres(text, text, uuid, uuid[], uuid);
*/
