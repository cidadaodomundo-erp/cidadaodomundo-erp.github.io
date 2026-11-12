# fabio-ponto-leitura

Leitura separada do Ponto ao Vivo (só leitura). `leitura.mjs` = regra pura (testável em Node); `index.ts` = handler Deno fino.

## Contrato
`GET /functions/v1/fabio-ponto-leitura?dia=YYYY-MM-DD&unidade=AGUA VERDE|SÃO BRAZ|AHU|REDE`, `Authorization: Bearer <JWT da pessoa>`.
Resposta 200: `{fonte, dia, unidade, unidades, consultadoEm, lidoEm, pessoas, batidas, batidasAnterior, anterior:{pedido,ok}, refeicoes:{disponivel,porPessoa,identificados}, refeicoesAnterior, avisos}`.
Erros: só `{erro:codigo}` (401, 403, 400, 405, 502). Falha do Flash = 502; a tela NÃO cai para `rh_flash_batida`.

## Pré-requisitos (feitos pelo Codex, não por este código)
- Segredo `vault.decrypted_secrets` name = `fabio_ponto_flash_api` (chave BUSINESS do Flash).
- Tabela `fabio_ponto.vinculo_refeicao(unidade text, tipo text CARTAO|APELIDO, chave text, nome text, valido_desde date)`, preenchida só com cadastro.
- `tipo` aceita também `CATEGORIA_CARTAO` (chave = comanda, texto) e `CATEGORIA_CLIENTE` (chave = `cliente_nome` EXATO normalizado, sem substring); `nome` = rótulo da categoria (sanitizado, até 30 caracteres, não precisa existir no cadastro). Categoria é conjunto, nunca pessoa: sai em `refeicoes.categorias[{rotulo,total,itens}]`, nunca em `porPessoa`/`identificados`. Mapas por tipo+unidade+chave+vigência; rótulos diferentes na mesma vigência = conflito (ninguém recebe). Categoria vence o alias da observação; categoria + cartão de pessoa na mesma venda = conflito. `APELIDO` aceita 2+ caracteres (token inteiro); 1 é rejeitado. Avisos só com contagens e rótulos de categoria (nunca chave, cliente ou observação); itens sem categoria e sem pessoa continuam como "sem dono".
- Lançamento avulso (só esses lançamentos; nunca cartão reutilizável como mapa fixo): `tipo` aceita `PESSOA_VENDA` (chave = `id_sale` textual; `nome` = nome completo, resolvido só com unidade única, como `CARTAO`) e `CATEGORIA_VENDA` (chave = `id_sale`; `nome` = rótulo, conjunto). `valido_desde` é OBRIGATÓRIO e deve ser a data EXATA do lançamento: só vale quando === dia pedido (outro dia = ignorado; NULL/inválido = rejeitado). Mapas separados por unidade+venda+data; duas identidades diferentes = conflito (ninguém recebe). `PESSOA_VENDA` pode atribuir item órfão, mas contra cartão/alias pessoal de OUTRA pessoa é conflito; qualquer categoria × `PESSOA_VENDA` = conflito; categoria × cartão pessoal = conflito; categoria vence só o alias da observação. O `CHECK` da tabela (tipos aceitos e `valido_desde` obrigatório para esses dois) e o cadastro das resoluções são do Codex, após o revisor. A resposta leva só Pessoa/categoria mínimas: nunca `id_sale`, cliente ou observação.
- Aviso "sem pessoa ativa" conta só vínculo efetivamente USADO por item/venda elegível do dia (cartão exato, alias por frase inteira, id_sale); vínculo antigo/desligado não usado não é pendência e não avisa. Vínculo usado sem pessoa segue como aviso/órfão (a linha não some e nunca é mapeada por primeiro nome).
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

