-- 28/11/2026: Mapa de acessos (acessos/index.html). Inventário, por unidade, de sistemas, integrações, contas, e-mails,
-- internet, modems, câmeras, computadores, robôs e backups: responsável, situação, se depende do ERP e a REFERÊNCIA
-- ao cofre (o nome do item no gerenciador de senhas). Senha, token e chave NUNCA entram aqui: ficam no cofre.
-- Acesso: só os donos (eh_dono()), conferido no servidor pela RLS, para ler e para gravar. anon não tem nada.
-- Desfazer: supabase/mapa-acessos-desfazer.sql

CREATE TABLE IF NOT EXISTS public.mapa_acesso (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unidade       text NOT NULL DEFAULT 'REDE'
                CHECK (unidade IN ('REDE','AGUA VERDE','SAO BRAZ','AHU','BOQUEIRAO')),
  categoria     text NOT NULL
                CHECK (categoria IN ('sistema','integracao','conta','email','internet','modem','camera','computador','robo','backup')),
  nome          text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  descricao     text CHECK (descricao IS NULL OR length(descricao) <= 500),
  responsavel   text CHECK (responsavel IS NULL OR length(responsavel) <= 80),
  situacao      text NOT NULL DEFAULT 'A_CONFERIR' CHECK (situacao IN ('OK','A_CONFERIR','A_TROCAR','PARADO')),
  depende_erp   text NOT NULL DEFAULT 'A_CONFERIR' CHECK (depende_erp IN ('SIM','NAO','PARCIAL','A_CONFERIR')),
  ref_cofre     text CHECK (ref_cofre IS NULL OR length(ref_cofre) <= 120),
  origem        text,            -- de onde veio a linha (ex.: 'levante:123' = plano_levante_neto.id 123)
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por text
);
CREATE UNIQUE INDEX IF NOT EXISTS mapa_acesso_origem_uq ON public.mapa_acesso (origem) WHERE origem IS NOT NULL;

-- Barreira contra segredo digitado por engano + carimbo de quem mexeu (o e-mail sai do token, nunca da tela).
CREATE OR REPLACE FUNCTION public.mapa_acesso_antes_gravar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v text := concat_ws(' ', NEW.nome, NEW.descricao, NEW.responsavel, NEW.ref_cofre);
BEGIN
  IF v ~* '(senha|password|passwd|pwd|token|secret|api[_ -]?key|chave)\s*[:=]'
     OR v ~ 'eyJ[A-Za-z0-9_-]{10,}\.'                          -- JWT
     OR v ~ '(sk-|ghp_|gho_|github_pat_|xox[bp]-|AKIA)[A-Za-z0-9_-]{8,}'
     OR v ~ '[A-Za-z0-9+/_=-]{40,}' THEN                         -- sequência longa sem espaço (cara de chave)
    RAISE EXCEPTION 'Parece senha, token ou chave. Aqui só vai o NOME do item no cofre.' USING ERRCODE = '22023';
  END IF;
  NEW.atualizado_em := now();
  NEW.atualizado_por := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.mapa_acesso_antes_gravar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mapa_acesso_antes_gravar ON public.mapa_acesso;
CREATE TRIGGER mapa_acesso_antes_gravar BEFORE INSERT OR UPDATE ON public.mapa_acesso
  FOR EACH ROW EXECUTE FUNCTION public.mapa_acesso_antes_gravar();

ALTER TABLE public.mapa_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapa_acesso FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mapa_acesso_so_dono ON public.mapa_acesso;
CREATE POLICY mapa_acesso_so_dono ON public.mapa_acesso FOR ALL TO authenticated
  USING (public.eh_dono()) WITH CHECK (public.eh_dono());

REVOKE ALL ON public.mapa_acesso FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mapa_acesso TO authenticated;
