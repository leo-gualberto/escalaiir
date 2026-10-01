-- ============================================================
-- Permite o status 'expirada' em trocas
--
-- A versão que fecha sozinha os pedidos de culto que já passou grava
-- status='expirada'. A tabela tinha um CHECK antigo aceitando apenas
-- aberta/aceita/cancelada, então TODA a sincronização passou a falhar com
-- violação de restrição — não só a troca: o app para no meio e mostra
-- "Não consegui salvar na nuvem".
--
-- Rode este script; não é preciso publicar nada no app depois.
-- ============================================================

alter table public.trocas drop constraint if exists trocas_status_check;

alter table public.trocas
  add constraint trocas_status_check
  check (status in ('aberta', 'aceita', 'cancelada', 'expirada'));

-- Conferência: tem de listar os quatro valores
select pg_get_constraintdef(oid) as restricao
  from pg_constraint
 where conrelid = 'public.trocas'::regclass and conname = 'trocas_status_check';
