-- ============================================================
-- Isolamento entre igrejas (pré-requisito para criar um time novo)
--
-- O banco já foi desenhado multi-igreja: quase toda política filtra por
-- minha_igreja(). Oito políticas, porém, checam só a PERMISSÃO da pessoa,
-- sem olhar a igreja. Com uma única igreja isso não aparece; com duas, um
-- líder da igreja B alcançaria dados da igreja A (escalas, habilidades,
-- ausências, indisponibilidades e aparelhos com notificação).
--
-- Este script reescreve essas políticas somando o escopo da igreja. Não
-- muda nada do que o seu time já faz hoje — só fecha a porta lateral.
-- Rodar no SQL Editor ANTES de criar a segunda igreja.
-- ============================================================

-- ---------- escalas: o líder só mexe nos cultos da própria igreja ----------
drop policy if exists es_lider on public.escalas;
create policy es_lider on public.escalas for all
  using (
    pode('escalas')
    and evento_id in (select id from public.eventos where igreja_id = minha_igreja())
  )
  with check (
    pode('escalas')
    and evento_id in (select id from public.eventos where igreja_id = minha_igreja())
  );

-- ---------- eventos_equipes ----------
drop policy if exists ee_edit on public.eventos_equipes;
create policy ee_edit on public.eventos_equipes for all
  using (
    pode('eventos')
    and evento_id in (select id from public.eventos where igreja_id = minha_igreja())
  )
  with check (
    pode('eventos')
    and evento_id in (select id from public.eventos where igreja_id = minha_igreja())
  );

-- ---------- funcoes ----------
drop policy if exists f_edit on public.funcoes;
create policy f_edit on public.funcoes for all
  using (
    pode('equipes')
    and equipe_id in (select id from public.equipes where igreja_id = minha_igreja())
  )
  with check (
    pode('equipes')
    and equipe_id in (select id from public.equipes where igreja_id = minha_igreja())
  );

-- ---------- habilidades ----------
drop policy if exists h_edit on public.habilidades;
create policy h_edit on public.habilidades for all
  using (pode('pessoas') and eh_da_minha_igreja(perfil_id))
  with check (pode('pessoas') and eh_da_minha_igreja(perfil_id));

drop policy if exists h_ver on public.habilidades;
create policy h_ver on public.habilidades for select
  using (
    perfil_id = meu_perfil()
    or ((pode('escalas') or pode('pessoas')) and eh_da_minha_igreja(perfil_id))
  );

-- ---------- indisponibilidades ----------
drop policy if exists in_edit on public.indisponibilidades;
create policy in_edit on public.indisponibilidades for all
  using (perfil_id = meu_perfil() or (pode('escalas') and eh_da_minha_igreja(perfil_id)))
  with check (perfil_id = meu_perfil() or (pode('escalas') and eh_da_minha_igreja(perfil_id)));

drop policy if exists in_ver on public.indisponibilidades;
create policy in_ver on public.indisponibilidades for select
  using (perfil_id = meu_perfil() or (pode('escalas') and eh_da_minha_igreja(perfil_id)));

-- ---------- ausencias ----------
drop policy if exists au_edit on public.ausencias;
create policy au_edit on public.ausencias for all
  using (perfil_id = meu_perfil() or (pode('pessoas') and eh_da_minha_igreja(perfil_id)))
  with check (perfil_id = meu_perfil() or (pode('pessoas') and eh_da_minha_igreja(perfil_id)));

drop policy if exists au_ver on public.ausencias;
create policy au_ver on public.ausencias for select
  using (
    perfil_id = meu_perfil()
    or ((pode('escalas') or pode('pessoas')) and eh_da_minha_igreja(perfil_id))
  );

-- ---------- push_assinaturas ----------
drop policy if exists pa_lider on public.push_assinaturas;
create policy pa_lider on public.push_assinaturas for select
  using ((pode('pessoas') or pode('escalas')) and eh_da_minha_igreja(perfil_id));

-- ---------- trocas: criar pedido em nome de outro só dentro da igreja ----------
drop policy if exists tr_criar on public.trocas;
create policy tr_criar on public.trocas for insert
  with check (de_id = meu_perfil() or (pode('trocas') and eh_da_minha_igreja(de_id)));

-- ---------- escalas: assumir troca, mas só dentro da igreja ----------
-- O with_check desta política já barrava a gravação cruzada; o using ganha o
-- mesmo escopo para a intenção ficar explícita na leitura.
drop policy if exists es_troca on public.escalas;
create policy es_troca on public.escalas for update
  using (
    evento_id in (select id from public.eventos where igreja_id = minha_igreja())
    and exists (
      select 1 from public.trocas t
       where t.escala_id = escalas.id and t.status = 'aberta'
    )
  )
  with check (
    evento_id in (select id from public.eventos where igreja_id = minha_igreja())
  );

-- ---------- código de acesso único entre TODAS as igrejas ----------
-- resgatar_convite() procura o código no banco inteiro. Com duas igrejas,
-- dois códigos iguais colocariam a pessoa na igreja errada.
create unique index if not exists perfis_codigo_uk on public.perfis (codigo);

-- Conferência: nenhuma linha abaixo deve sobrar sem filtro de igreja
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and qual is not null
   and qual not like '%minha_igreja%'
   and qual not like '%meu_perfil%'
   and qual not like '%auth.uid%'
 order by tablename, policyname;
