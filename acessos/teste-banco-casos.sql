-- 2) casos. Cada bloco falha (ON_ERROR_STOP) se o resultado não for o esperado.
\set QUIET on
-- carga: 3 linhas (CONTA x2 + PC rotina), sem AVISO e sem "Do que tudo depende"; obs não veio; rodar de novo não repete
DO $$ BEGIN
  IF (SELECT count(*) FROM mapa_acesso) <> 3 THEN RAISE EXCEPTION 'carga: esperava 3, veio %', (SELECT count(*) FROM mapa_acesso); END IF;
  IF EXISTS (SELECT 1 FROM mapa_acesso WHERE concat_ws(' ', nome, descricao) ILIKE '%OBS LIVRE%') THEN RAISE EXCEPTION 'carga copiou obs'; END IF;
  IF (SELECT categoria FROM mapa_acesso WHERE origem = 'levante:3') <> 'robo' THEN RAISE EXCEPTION 'categoria do robô'; END IF;
  IF (SELECT situacao FROM mapa_acesso WHERE origem = 'levante:2') <> 'OK' THEN RAISE EXCEPTION 'FEITO deveria virar OK'; END IF;
  RAISE NOTICE 'OK carga';
END $$;
\i supabase/mapa-acessos-carga.sql
DO $$ BEGIN IF (SELECT count(*) FROM mapa_acesso) <> 3 THEN RAISE EXCEPTION 'carga repetiu linha'; END IF; RAISE NOTICE 'OK carga sem repetir'; END $$;

-- anon: não lê nem grava
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM mapa_acesso; RAISE EXCEPTION 'anon leu'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK anon sem leitura'; END;
  BEGIN INSERT INTO mapa_acesso (categoria, nome) VALUES ('conta', 'x'); RAISE EXCEPTION 'anon gravou'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK anon sem gravação'; END;
END $$;
RESET ROLE;

-- logado que NÃO é dono (gerente fictício): vê 0, não grava, não altera, não apaga
SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"email":"gerente@exemplo.test","role":"authenticated"}', false);
DO $$ DECLARE n int; BEGIN
  IF (SELECT count(*) FROM mapa_acesso) <> 0 THEN RAISE EXCEPTION 'não-dono viu linhas'; END IF;
  BEGIN INSERT INTO mapa_acesso (categoria, nome) VALUES ('conta', 'invasor'); RAISE EXCEPTION 'não-dono gravou';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK não-dono bloqueado ao gravar'; END;
  UPDATE mapa_acesso SET nome = 'mexido'; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION 'não-dono alterou'; END IF;
  DELETE FROM mapa_acesso; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 0 THEN RAISE EXCEPTION 'não-dono apagou'; END IF;
  RAISE NOTICE 'OK não-dono: 0 linhas, nada alterado nem apagado';
END $$;
-- sem e-mail no token (logado estranho)
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
DO $$ BEGIN IF (SELECT count(*) FROM mapa_acesso) <> 0 THEN RAISE EXCEPTION 'token sem e-mail viu'; END IF; RAISE NOTICE 'OK token sem e-mail bloqueado'; END $$;

-- dono B (segundo dono da lista): lê tudo, grava, altera, apaga; carimbo vem do token
SELECT set_config('request.jwt.claims', '{"email":"Dono.B@exemplo.test","role":"authenticated"}', false);
DO $$ DECLARE i bigint; n int; BEGIN
  IF (SELECT count(*) FROM mapa_acesso) <> 3 THEN RAISE EXCEPTION 'dono não viu as 3'; END IF;
  INSERT INTO mapa_acesso (unidade, categoria, nome, responsavel, situacao, depende_erp, ref_cofre)
    VALUES ('AHU', 'modem', 'Modem fictício', 'Fulano Teste', 'OK', 'NAO', 'Cofre › Internet › Modem fictício') RETURNING id INTO i;
  IF (SELECT atualizado_por FROM mapa_acesso WHERE id = i) <> 'dono.b@exemplo.test' THEN RAISE EXCEPTION 'carimbo errado'; END IF;
  UPDATE mapa_acesso SET situacao = 'A_TROCAR' WHERE id = i; GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'dono não alterou'; END IF;
  RAISE NOTICE 'OK dono grava e altera (id %)', i;
END $$;
-- segredo é recusado, em qualquer campo
DO $$ BEGIN
  BEGIN INSERT INTO mapa_acesso (categoria, nome, ref_cofre) VALUES ('conta', 'x', 'senha: 123456'); RAISE EXCEPTION 'aceitou senha';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'OK recusou "senha:"'; END;
  BEGIN INSERT INTO mapa_acesso (categoria, nome, descricao) VALUES ('conta', 'x', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc'); RAISE EXCEPTION 'aceitou JWT';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'OK recusou JWT'; END;
  BEGIN INSERT INTO mapa_acesso (categoria, nome, ref_cofre) VALUES ('conta', 'x', 'ghp_ABCDEFGHIJKLMNOP1234'); RAISE EXCEPTION 'aceitou token GitHub';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'OK recusou token'; END;
  BEGIN INSERT INTO mapa_acesso (categoria, nome) VALUES ('senha', 'x'); RAISE EXCEPTION 'aceitou categoria inválida';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK categoria inválida recusada'; END;
END $$;
RESET ROLE;
-- persistência: a linha do dono continua lá numa sessão nova (sem papel, como o banco vê)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM mapa_acesso WHERE nome = 'Modem fictício' AND situacao = 'A_TROCAR' AND unidade = 'AHU') THEN RAISE EXCEPTION 'não persistiu'; END IF;
  RAISE NOTICE 'OK persistiu';
END $$;
-- dono A apaga a linha de teste
SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"email":"dono.a@exemplo.test"}', false);
DO $$ DECLARE n int; BEGIN DELETE FROM mapa_acesso WHERE nome = 'Modem fictício'; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'dono não apagou'; END IF; RAISE NOTICE 'OK dono apaga'; END $$;
RESET ROLE;
-- desfazer funciona
\i supabase/mapa-acessos-desfazer.sql
DO $$ BEGIN IF to_regclass('public.mapa_acesso') IS NOT NULL THEN RAISE EXCEPTION 'desfazer falhou'; END IF; RAISE NOTICE 'OK desfazer'; END $$;
