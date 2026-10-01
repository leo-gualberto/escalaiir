-- ============================================================
-- Conserta "function gen_random_bytes(integer) does not exist"
-- ao ativar a agenda do celular
--
-- O token da assinatura é gerado com gen_random_bytes, da extensão pgcrypto.
-- No Supabase a pgcrypto fica no schema "extensions", e as duas funções
-- abaixo fixam search_path = public — então a chamada não enxergava nada.
-- A correção é chamar a função pelo nome completo. Não muda o formato do
-- token nem invalida assinatura nenhuma.
-- ============================================================

create or replace function public.meu_token_agenda()
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  meu uuid := meu_perfil();
  t   text;
begin
  if meu is null then
    raise exception 'este aparelho ainda não está ligado a um cadastro';
  end if;

  select a.token into t from agendas a where a.perfil_id = meu;

  if t is null then
    -- 24 bytes em base64url: 32 caracteres, sem + / = para não quebrar a URL
    t := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
    insert into agendas (perfil_id, token) values (meu, t);
  end if;

  return t;
end $function$;

create or replace function public.trocar_token_agenda()
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  meu uuid := meu_perfil();
  t   text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
begin
  if meu is null then
    raise exception 'este aparelho ainda não está ligado a um cadastro';
  end if;

  insert into agendas (perfil_id, token) values (meu, t)
    on conflict (perfil_id) do update set token = excluded.token, criado_em = now();

  return t;
end $function$;

-- Conferência: tem de devolver 32
select length(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'))
       as tamanho_do_token;
