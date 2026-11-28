-- Teste ISOLADO do Mapa de acessos (Postgres local, dados fictícios). Roda: psql -v ON_ERROR_STOP=1 -f acessos/teste-banco.sql
-- 1) imitação mínima do Supabase: papéis, auth.jwt(), rmb_config, eh_dono() (cópia da função do ERP), levantamento fictício
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.rmb_config (chave text PRIMARY KEY, valor text);
INSERT INTO public.rmb_config VALUES ('email_dono', 'dono.a@exemplo.test'), ('emails_dono', 'dono.a@exemplo.test,dono.b@exemplo.test');
CREATE FUNCTION public.eh_dono() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT lower(coalesce(auth.jwt() ->> 'email','')) <> '' AND (
         lower(coalesce(auth.jwt() ->> 'email','')) = lower((SELECT valor FROM rmb_config WHERE chave = 'email_dono'))
      OR lower(coalesce(auth.jwt() ->> 'email','')) IN (
           SELECT lower(btrim(e)) FROM regexp_split_to_table(coalesce((SELECT valor FROM rmb_config WHERE chave = 'emails_dono'), ''), ',') e
            WHERE btrim(e) <> '')) $f$;
CREATE TABLE public.plano_levante_neto (id int PRIMARY KEY, lista text, grupo text, nome text, o_que text, hoje text, trocar text, estado text, feito_em date, obs text);
INSERT INTO public.plano_levante_neto VALUES
  (1, 'CONTA', 'E-mail', 'Caixa de exemplo', 'caixa fictícia', null, null, 'A_TROCAR', null, 'OBS LIVRE NAO PODE VIR'),
  (2, 'CONTA', 'Sistema do painel', 'Sistema fictício', 'teste', null, null, 'FEITO', '2026-11-01', null),
  (3, 'PC', 'Rotinas do Claude (precisam do app aberto)', 'robo-ficticio', 'lê algo', null, null, 'A_TROCAR', null, null),
  (4, 'PC', 'Do que tudo depende', 'PC ligado', null, null, null, 'A_TROCAR', null, null),
  (5, 'AVISO', 'X', 'aviso fictício', null, null, null, 'A_TROCAR', null, null);
