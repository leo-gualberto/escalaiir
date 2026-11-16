-- Avisos mais rapidos e lembrete no dia do culto
--
-- ANTES DE RODAR: atualize o codigo da funcao "avisos-push" no Supabase
-- (Edge Functions > avisos-push > Code > colar supabase/functions/avisos-push/index.ts
-- > Deploy updates). Este SQL passa os disparos para essa funcao.
--
-- O que muda:
--   fila de avisos (troca, alertas):  de 5 em 5 min  -> todo minuto
--   "voce foi escalado":              de 15 em 15    -> de 5 em 5 min
--     (nao todo minuto de proposito: enquanto o lider monta a escala, ele
--      troca as pessoas de lugar; 5 minutos evitam avisar quem vai sair)
--   novo: lembrete no dia, ate 2h30 antes da hora de chegar, a cada 10 min
--
-- Para voltar atras: rodar o bloco "DESFAZER" no fim do arquivo.

-- 1) os disparos passam a chamar a funcao avisos-push
select cron.alter_job(jobid, command := replace(command, '/functions/v1/enviar-push', '/functions/v1/avisos-push'))
  from cron.job where jobname in ('push-avisos', 'push-convocacao', 'push-lembrete-1');

-- 2) mais rapidez
select cron.alter_job(jobid, schedule := '* * * * *')   from cron.job where jobname = 'push-avisos';
select cron.alter_job(jobid, schedule := '*/5 * * * *') from cron.job where jobname = 'push-convocacao';

-- 3) lembrete no dia (copia o disparo da vespera, trocando o tipo)
select cron.schedule('push-hoje', '*/10 * * * *',
  (select replace(command, '{"tipo":"lembrete","dias":1}', '{"tipo":"hoje"}')
     from cron.job where jobname = 'push-lembrete-1'));

-- conferencia: as quatro linhas devem ter nova_funcao = true
select jobname, schedule, position('avisos-push' in command) > 0 as nova_funcao,
       position('"tipo":"hoje"' in command) > 0 as e_o_do_dia
  from cron.job order by jobname;

/* ---------------- DESFAZER ----------------
select cron.unschedule('push-hoje');
select cron.alter_job(jobid, command := replace(command, '/functions/v1/avisos-push', '/functions/v1/enviar-push'))
  from cron.job where jobname in ('push-avisos', 'push-convocacao', 'push-lembrete-1');
select cron.alter_job(jobid, schedule := '*/5 * * * *')  from cron.job where jobname = 'push-avisos';
select cron.alter_job(jobid, schedule := '*/15 * * * *') from cron.job where jobname = 'push-convocacao';
*/
