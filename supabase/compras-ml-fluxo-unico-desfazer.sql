-- DESFAZER compras-ml-fluxo-unico.sql (21/11/2026). Rodar inteiro no SQL Editor do Supabase ERP.
-- Tira o gatilho, as funções e a fila de avisos. As colunas novas ficam (vazias não atrapalham); apague só se quiser.
begin;
drop trigger if exists compra_ml_ao_gravar on public.fin_cartao_compra;
drop function if exists public.compra_ml_ao_gravar();
drop function if exists public.compra_ml_historico(int);
drop function if exists public.compra_aviso_pegar(text, int);
drop function if exists public.compra_aviso_marcar(text, bigint, text);
drop function if exists public.compra_palavras(text);
drop function if exists public.compra_ml_loja(jsonb);
drop table if exists public.compra_aviso;
-- opcional:
-- alter table public.fin_cartao_compra drop column if exists entregue_em, drop column if exists cotacao_id;
-- alter table public.compra_cotacao drop column if exists pedido_ml;
commit;
