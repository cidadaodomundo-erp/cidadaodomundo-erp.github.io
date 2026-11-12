# fabio-ponto-leitura

Leitura separada do Ponto ao Vivo (só leitura). `leitura.mjs` = regra pura (testável em Node); `index.ts` = handler Deno fino.

## Contrato
`GET /functions/v1/fabio-ponto-leitura?dia=YYYY-MM-DD&unidade=AGUA VERDE|SÃO BRAZ|AHU|REDE`, `Authorization: Bearer <JWT da pessoa>`.
Resposta 200: `{fonte, dia, unidade, unidades, consultadoEm, lidoEm, pessoas, batidas, batidasAnterior, anterior:{pedido,ok}, refeicoes:{disponivel,porPessoa,identificados}, refeicoesAnterior, avisos}`.
Erros: só `{erro:codigo}` (401, 403, 400, 405, 502). Falha do Flash = 502; a tela NÃO cai para `rh_flash_batida`.

## Pré-requisitos (feitos pelo Codex, não por este código)
- Segredo `vault.decrypted_secrets` name = `fabio_ponto_flash_api` (chave BUSINESS do Flash).
- Tabela `fabio_ponto.vinculo_refeicao(unidade text, tipo text CARTAO|APELIDO, chave text, nome text, valido_desde date)`, preenchida só com cadastro.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` automáticas. Opcional: `FABIO_PONTO_ORIGENS` (origens permitidas, separadas por vírgula; vazio = só `https://cidadaodomundo-erp.github.io`; `*` nunca vale; origem de fora = 403 antes de ler dados; sem `Origin` passa se o JWT for válido).
- Tabela privada `fabio_ponto.jornada(unidade, nome, entrada time, saida time, conferido_em date)` (retrato de até 7 dias; não é escala diária). Limite: 12 chamadas/60 s por usuário (429).
- Modo Água Verde: dia operacional (antes das 07:00 ainda é ontem); batidas só em [07:00 do dia, 03:00 do seguinte).
- O papel usado por `SUPABASE_DB_URL` precisa de SELECT no vault e em `fabio_ponto.vinculo_refeicao` (a função só abre transação READ ONLY).

## Comandos
```
node --test supabase/functions/fabio-ponto-leitura/     # backend (módulo puro)
node --test pessoas/                                    # tela + modelo (inclui os testes anteriores)
supabase functions deploy fabio-ponto-leitura           # SÓ depois da revisão do supervisor
```

## Invariantes
Nunca cria RPC/grant/policy; nunca expõe o schema `fabio_ponto`; REST sempre com o JWT do chamador (RLS vale); cache só da leitura bruta do Flash por empresa/dia (TTL 60 s, dedupe, falha não é guardada); o que sai é filtrado pelo cadastro que o chamador enxerga.

