# Cardápio completo HML (loja de teste 93936) — carrinho + envio com mapa estrito

Só loja HML. Sem produção, sem robô/agenda/instalação, sem pagamento real. A raiz `http://127.0.0.1:4654/` abre `public/cardapio-hml.html`; `saipos.html` (ensaio do produto Diversos), `cozinha-hml.html` e `tv-hml.html` seguem iguais.

## Peças
- `data/gama-cardapio.json` — DTO seguro (nomes, descrições, preços em **centavos**, variações, status, horários, grupos, opções, URLs públicas). Cópia de 11/11; a tela mostra a data ("pode não refletir mudanças posteriores"). Nada de custo/fiscal/segredo.
- `src/cardapio-hml.js` — valida o DTO, carrega o mapa, calcula horários (America/Sao_Paulo, relógio injetável) e valida o carrinho. Nada vem calculado do cliente.
- `../saipos-teste/src/carrinho.js` — **formato preparado 2** (arquivo novo; o legado de 1 item em `payload.js`/`envio.js` não mudou): até 20 itens, quantidade 1..20, complementos com quantidade, sem complemento repetido no item, ledger `wx` antes do POST, uma tentativa por `order_id`.
- `src/saipos-hml.js` — novas rotas e opções `criarServidorHml({ envPath, fetchImpl, gamaPath, mapPath, agora })`.
- `public/cardapio-hml.{html,js,css}` — tela (só `textContent`, sem HTML dinâmico). Fotos: `/gama-fotos/p<ID>.webp` (pasta `public/gama-fotos/`, preenchida pelo Codex; sem arquivo ⇒ quadro neutro).

## Rotas (mesmas guardas de sempre: Host/Origin exatos, CSRF, JSON, 16 KB, sem CORS, `no-store`, CSP)
- `GET /api/hml/cardapio` — DTO filtrado + `mapa: "ausente"|"ok"|"invalido"`, por variação `pronto`/`opcoesProntas`/`motivoBloqueio`, e `disponivelAgora`/`motivoIndisponivel` (`fora_do_horario`|`indisponivel`). **Nunca** devolve códigos Saipos.
- `POST /api/hml/carrinho` — `{ idempotencyKey, itens: [{ produto, variacao, quantidade, opcoes: [{ opcao, quantidade }], obs? }] }`. Campos extras (preço, total…) ⇒ 400.
- Resposta/estado: mesmos de sempre (`aceito|ambiguo|recusado|nao_enviado|bloqueado`) + `totalCentavos`. HTTP 200 da API só significa **recebido pela API**; a cozinha precisa ser conferida na UI. `GET /api/hml/status?chave=` serve o recarregamento.

## Regras do servidor (antes de qualquer reserva/auth/prepare/ledger/contador)
- Produto e categoria ativos/visíveis e dentro de dias+horários (produto **e** categoria). Fora ⇒ 409 `fora_do_horario`.
- Variação existente; quantidade do item 1..20 (1 se `ocultarQuantidade`); observação ≤ 80 caracteres, sem controle, vetada se `ocultarObservacao`.
- Grupos: só os **ativos** do produto (grupo inativo, ex. 38, é ignorado: não exige mínimo, não aceita escolha). Soma das quantidades entre `minimo` e `maximo`; quantidade > 1 só se `permitir_quantidade`; opção inativa ou de outro grupo/produto rejeitada; opção repetida no item rejeitada. Grupos usados têm `cobrar_apartir_de` 0 (outro valor ⇒ DTO recusado).
- Total = `SUM((preço_variação + SUM(preço_opção × qtd_opção)) × qtd_item)` em centavos (fórmula oficial de `criar-pedido.md`); convertido para reais **só** no JSON do fio; limite do ensaio R$ 100.000. Pagamento `DIN` = total (metadado de teste, nada é cobrado).
- Mapa Gama → HML obrigatório para enviar (ver abaixo); sem ele o cardápio abre e o carrinho pode ser revisado, mas `POST` devolve 409 `item_nao_pronto` ("Ainda estamos preparando este item na loja de teste").
- Idempotência: chave UUID → hash do carrinho (tipo próprio, não colide com o corpo legado). Mesma chave+mesmo carrinho ⇒ mesmo resumo sem novo POST; outro carrinho ⇒ 409. Reserva persistida (`ui-hml-state.json`, fora de `outputs/`), fila serial, `orderId` gravado antes do envio. Timeout/5xx/reinício ⇒ `ambiguo`, nunca reenvio automático. Aceitos entram em PREPARANDO (cozinha/TV como antes). O contador legado foi usado pelo pedido de teste 9202 (ficha 3); a próxima senha é 9203.

## Mapa `gama-hml-map.json` (ao lado do `.env`, fora de `outputs/`)
Exemplo: `data/gama-hml-map.example.json` (códigos **falsos** `EXEMPLO-…`). Contrato **versão 2** (a versão 1, com `opcoes` só por `opcao`, continua aceita para os testes legados):
```json
{ "schema": "gama-hml-map", "version": 2, "storeUuid": "ef2dc467-a4a8-4734-a4d7-eb3442ff3401",
  "itens":  [ { "produto": <id Gama>, "variacao": <indice>, "codigoHml": "<codigo cadastrado na HML>", "precoCentavos": <centavos> } ],
  "opcoes": [ { "produto": <id Gama>, "variacao": <indice>, "opcao": <id Gama>, "codigoHml": "<codigo exato do complemento>", "precoCentavos": <centavos> } ],
  "grupos": [ { "grupo": <id Gama>, "idStoreChoice": <id_store_choice na HML> } ] }
```
- **Por que a tripla:** na API real o `codigo_saipos` do complemento é **composto** (código da variação + `.` + id da opção, ex.: `43626137.27779974`). O prefixo muda por produto/tamanho, então o mesmo id de opção tem códigos diferentes. Use o código exato do catálogo; nunca corte o prefixo nem invente formato.
- v2 no servidor: o item precisa ter `tamanho` igual ao nome da variação (nunca fallback para vazio/ambíguo), `codigo_interno` (se presente) igual a `GAMA<id do produto>` e um único `id_store_item`. O complemento só vale se for do **mesmo** `id_store_item` **e** mesmo `tamanho`, com `complemento_item` = nome da opção, `complemento` = nome do grupo (quando presente), um único `id_store_choice`, preço igual, `min_choices`/`max_choices` **inteiros e iguais** ao grupo Gama e status habilitado. Código de outra variação/loja/item ⇒ `complemento_outro_item_ou_ausente`; novos motivos: `tamanho_diferente`, `item_de_outro_produto`, `item_ambiguo`, `grupo_ambiguo`, `opcao_nome_diferente`.
- Gerador: `work/montar-mapa-hml.mjs` (puro, só argumentos) emite v2 (`complemento` = nome do grupo, `codigo_interno` = `GAMA<id>`, `tamanho` exato; sem deduplicar por código global). `grupos` só inclui o grupo se o `id_store_choice` for o mesmo em todos os itens. Aceita tabela `verificados.itens`, mas nunca adivinha só por nome.
- `storeUuid` precisa ser o UUID da loja HML (o servidor ainda exige o `codStore` exato na subida, antes de qualquer rede). `grupos` é opcional (confere o `id_store_choice`).
- Chaves únicas (`produto+variacao`; v2: `produto+variacao+opcao`; v1: `opcao`); `codigoHml` de item único; strings `[A-Za-z0-9._-]{1,64}`; **nunca** `40101353` (Diversos não serve de descrição falsa); referências precisam existir no DTO; campos extras ⇒ mapa inválido.
- Bloqueios (409, `motivo`): `mapa_ausente`, `mapa_invalido`, `sem_mapeamento`, `codigo_hml_ausente` (ex.: ID do Gama no lugar do código HML), `preco_divergente` (mapa ≠ DTO ≠ catálogo HML), `desativado`, `complemento_outro_item_ou_ausente` (o complemento é procurado só entre as linhas do **mesmo item** HML — o código de complemento é global e aparece em vários itens), `limites_diferentes` (min/max do grupo Gama ≠ catálogo HML), `grupo_diferente`.
- Não mapear por nome sem conferência manual; o Codex preenche o mapa a partir da API HML depois de a UI confirmar o cadastro. O servidor lê o mapa e o catálogo HML **na subida** (reiniciar após cadastrar/editar).

## Comandos
```
node --test test/                         # tudo (legado + cardápio)
node --test test/cardapio-hml.test.js test/cardapio-hml-http.test.js
cd ../saipos-teste && node --test test/   # conector (legado de 1 item intacto)
$env:CONNECTOR_ENV_PATH="<abs, fora de outputs>"; node bin/start-saipos-hml.js --sandbox
```

## Pendências
- **Estado (11/11)**: cardápio completo com mapa v2 conferido na API HML (107 variações, 721 vínculos); pedido de teste 9202 chegou à cozinha. Fora deste ensaio e não implantados: aparelho e pagamento real, status automático do Saipos para a TV e cardápio ao vivo.
- Fotos locais: 93 arquivos baixados e conferidos como WebP em 11/11, total de 2.793.640 bytes. A cópia funciona com os arquivos locais, sem buscar fotos na VNDX durante o uso.
- Fora do escopo: webhooks, produção, TV física, pagamento real, ingredientes/remoções.
