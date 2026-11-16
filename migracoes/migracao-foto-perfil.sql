-- Foto de perfil
-- A foto e uma imagem pequena (128 x 128, JPEG, uns 6 KB) guardada no proprio
-- cadastro, em texto base64. O app reduz a imagem antes de enviar.
--
-- Quem pode gravar: as mesmas regras de hoje para o cadastro (a propria pessoa,
-- e quem cadastra pessoas). Nenhuma politica nova e necessaria.
--
-- Enquanto este arquivo nao rodar, o app nao mostra a opcao de foto e nao
-- envia a coluna -- por isso a ordem e: rodar este SQL, depois publicar.

alter table public.perfis add column if not exists foto text;

-- trava contra conteudo que nao e foto, ou grande demais
alter table public.perfis drop constraint if exists perfis_foto_valida;
alter table public.perfis add constraint perfis_foto_valida check (
  foto is null
  or (length(foto) < 60000 and foto ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')
);

-- conferencia: deve devolver uma linha com "foto | text"
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'perfis' and column_name = 'foto';
