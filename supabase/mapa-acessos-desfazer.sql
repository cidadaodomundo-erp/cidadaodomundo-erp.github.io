-- Desfaz supabase/mapa-acessos.sql (e a carga). Objetos novos de 28/11/2026: nada existia antes com estes nomes.
DROP TABLE IF EXISTS public.mapa_acesso;
DROP FUNCTION IF EXISTS public.mapa_acesso_antes_gravar();
