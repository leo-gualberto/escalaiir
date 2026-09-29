-- ============================================================
-- Código de acesso com validade, contagem de uso e revogação
--
-- Hoje o código de 6 letras é a senha da pessoa: não vence, não dá para
-- saber se foi usado e não há como desconectar um aparelho perdido. Quem
-- tiver o código de um administrador vira administrador.
--
-- Este script adiciona duas funções: uma para gerar um código novo
-- (invalidando o anterior na hora) e outra para desconectar os aparelhos de
-- um perfil — que é o que resolve celular perdido ou código que vazou.
--
-- Por decisão da liderança, código NÃO vence: os que já existem continuam
-- valendo para sempre e os novos nascem sem prazo. A coluna de validade
-- fica pronta caso um dia se queira um convite temporário: basta chamar
-- novo_codigo(perfil, 30).
--
-- Rode no SQL Editor antes de publicar a versão do app que usa isso; o app
-- avisa em Perfil → Diagnóstico da nuvem se faltar.
-- ============================================================

alter table public.perfis
  add column if not exists codigo_criado_em timestamptz not null default now(),
  add column if not exists codigo_expira_em timestamptz,
  add column if not exists codigo_usos       integer     not null default 0;

-- Nada de backfill: os códigos que já circulam continuam sem prazo.

-- ---------- resgatar: agora recusa código vencido e conta o uso ----------
create or replace function public.resgatar_convite(p_codigo text)
returns perfis language plpgsql security definer set search_path to 'public' as $function$
declare p perfis;
begin
  if auth.uid() is null then raise exception 'sem sessao'; end if;

  select * into p from perfis where codigo = upper(trim(p_codigo));
  if not found then raise exception 'codigo invalido'; end if;

  if p.codigo_expira_em is not null and p.codigo_expira_em < now() then
    raise exception 'codigo vencido — peca um novo a quem cuida da escala';
  end if;

  insert into acessos (user_id, perfil_id) values (auth.uid(), p.id)
    on conflict (user_id) do update set perfil_id = excluded.perfil_id;

  update perfis
     set entrou_em   = coalesce(entrou_em, now()),
         codigo_usos = coalesce(codigo_usos, 0) + 1
   where id = p.id
  returning * into p;

  return p;
end $function$;

-- ---------- gerar um código novo (o anterior deixa de valer) ----------
create or replace function public.novo_codigo(p_perfil uuid, p_dias integer default null)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare c text;
begin
  if p_perfil is distinct from meu_perfil()
     and not (pode('pessoas') and eh_da_minha_igreja(p_perfil)) then
    raise exception 'sem permissao';
  end if;

  -- gerar_codigo() sorteia; com o índice único, um sorteio repetido falha.
  -- tentar de novo é mais simples do que travar a tabela.
  for i in 1..10 loop
    begin
      update perfis
         set codigo           = gerar_codigo(),
             codigo_criado_em = now(),
             codigo_expira_em = case when p_dias is null or p_dias <= 0
                                     then null
                                     else now() + make_interval(days => p_dias) end,
             codigo_usos      = 0
       where id = p_perfil
      returning codigo into c;
      exit;
    exception when unique_violation then
      c := null;
    end;
  end loop;

  if c is null then raise exception 'nao consegui gerar um codigo novo'; end if;
  return c;
end $function$;

-- ---------- desconectar os aparelhos de um perfil ----------
create or replace function public.revogar_acessos(p_perfil uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  if p_perfil is distinct from meu_perfil()
     and not (pode('pessoas') and eh_da_minha_igreja(p_perfil)) then
    raise exception 'sem permissao';
  end if;

  delete from acessos where perfil_id = p_perfil;
  get diagnostics n = row_count;
  return n;
end $function$;

grant execute on function public.resgatar_convite(text) to anon, authenticated;
grant execute on function public.novo_codigo(uuid, integer) to anon, authenticated;
grant execute on function public.revogar_acessos(uuid)      to anon, authenticated;

-- Conferência: as três colunas e as duas funções novas
select column_name from information_schema.columns
 where table_schema='public' and table_name='perfis'
   and column_name in ('codigo_criado_em','codigo_expira_em','codigo_usos');
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in ('novo_codigo','revogar_acessos');
