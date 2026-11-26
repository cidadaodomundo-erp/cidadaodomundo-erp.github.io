-- Desfaz ponto-feito.sql (apaga as anotações "o que foi feito").
drop function if exists public.ponto_feito_gravar(date, integer, text, text);
drop table if exists public.ponto_feito;
