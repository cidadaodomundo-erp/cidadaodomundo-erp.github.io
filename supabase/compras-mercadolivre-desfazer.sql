-- =====================================================================================================================
--  DESFAZER o módulo Compras · Mercado Livre (17/11/2026). Rodar inteiro no SQL Editor do Supabase ERP.
--  Tudo o que compras-mercadolivre.sql criou nasceu novo em 17/11/2026 (nenhum objeto com estes nomes existia antes),
--  então desfazer é apagar. A Rita só perde a tela se a liberação dela foi a deste módulo (marca na observação).
--  No Escritório 2: desativar a tarefa "CDM Compras Mercado Livre (escritorio2)" e criar
--  whatsapp\CarteiroLojas\COMPRAS-DESLIGADO.txt (ou voltar carteiro-loja-antes-compras-17-11.js).
-- =====================================================================================================================
begin;

drop function if exists public.compra_wa_receber(text, text, text, text);
drop function if exists public.compra_robo_gravar(text, bigint, jsonb, jsonb, text);
drop function if exists public.compra_robo_pegar(text, int, jsonb);
drop function if exists public.compra_robo_pegar(text, int);
drop function if exists public.compra_cotacao_listar(int);
drop function if exists public.compra_cotacao_decidir(bigint, text, bigint);
drop function if exists public.compra_cotacao_pedir(text, text);
drop function if exists public.compra_busca_do_texto(text);
drop function if exists public.compra_link_do_texto(text);
drop function if exists public.compra_loja_do_texto(text);
drop function if exists public.compra_robo_segredo_ok(text);

-- as políticas de leitura saem junto com as tabelas; depois sai a função que elas usavam
drop table if exists public.compra_cotacao_oferta;
drop table if exists public.compra_cotacao;
drop table if exists public.compra_robo_estado;
drop function if exists public.compra_minha_loja(text);

delete from vault.secrets where name = 'compras_robo_segredo';

-- a Rita não tinha a tela antes de 17/11/2026 (a liberação só acontecia se faltasse); se a observação dela era vazia,
-- a marca não ficou gravada — por isso confere a marca OU a observação vazia
update public.painel_acesso
   set modulos = array_remove(modulos, 'mercadolivre'),
       observacao = coalesce(observacao, '') || ' | Mercado Livre desfeito',
       atualizado_em = now()
 where email = 'rita@cidadaodomundo.com.br'
   and 'mercadolivre' = any(modulos)
   and (observacao is null or observacao like '%17/11/2026: + Mercado Livre%');

commit;
