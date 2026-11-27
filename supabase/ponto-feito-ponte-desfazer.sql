-- Desfaz ponto-feito-ponte.sql
drop function if exists public.ponto_feito_respondidos(date, date, text);
drop table if exists public.ponto_ponte_chave;
