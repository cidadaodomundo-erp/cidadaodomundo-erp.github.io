# Conector de ensaio Saipos (loja TESTE / DEV)

**Estado atual (10/11/2026, ~23h35 BRT):** conector autenticado e com um envio real de teste feito na loja TESTE. Não é produção.

- Chave DEV salva em arquivo privado fora do pacote (não exibida aqui).
- `POST /auth` aceito.
- O arquivo de cardápio obtido por `GET /v2/catalog` veio como `{data: [...]}`, com um produto; o helper normaliza essa resposta.
- 37 testes offline passaram (`node --test test/`).
- Loja conferida na UI do Developer: "Cidadão do Mundo - HML" (loja `93936`). O `codStore` conferido é um UUID diferente do número da loja (valor não incluído aqui).
- Envio real único, apenas TESTE, pelo adaptador CLI: pedido `HML-20261111023156-2b454ddf`, `display_id` 9101, `ticket_reference` TESTE-9101, item "Diversos" (código 40101353, qtd 1, preço 0, total 0), observação `TESTE-NAOPRODUZIR`. `POST /order` respondeu HTTP 200 com `{}`. A UI confirmou a Ficha 1 (id Saipos 936102693, operador `integration-api-int-sale`) na coluna COZINHA.
- Não foi clicado em Imprimir. Na Ficha 1 foi clicado PEDIDO PRONTO: Cozinha 1 → 0 e Entregue 0 → 1. Não houve etapa "Pronto para retirada" nessa ficha.
- Abas de ensaio criadas foram fechadas. O servidor local da chave na porta 4651 foi encerrado após o salvamento.

Escopo: Order API da Saipos, módulo Ficha/TICKET. Não usa Data API nem Logística. Só Node 18+ e módulos nativos. O simulador `outputs/laboratorio-totem/` não foi alterado.

## Preparação (uma vez)

1. Defina o caminho absoluto do `.env`, **fora de `outputs/`** (ex.: `work/private-saipos/.env`). Sem isso o conector falha fechado.
   ```powershell
   $env:CONNECTOR_ENV_PATH = "C:\caminho\absoluto\work\private-saipos\.env"
   ```
2. `node bin/saipos-teste.js setup` cria o `.env` vazio (só se não existir) e mostra só o caminho.
3. Preencha **somente** `SAIPOS_SECRET=` no `.env` (veja `.env.example`).
4. Ao lado do `.env`, crie `test-store.json` conferindo na UI do Developer (modelo em `test-store.example.json`): `storeId` `93936`, `environment` `desenvolvimento`, `testStoreVerified` `true`, `expectedName` `Cidadão do Mundo - HML`, `codStore` e `idPartner`.

## Comandos

Rodar de dentro de `outputs/saipos-teste/`:

| Comando | O que faz |
|---|---|
| `node bin/saipos-teste.js setup` | Cria `.env` vazio se ausente. |
| `node bin/saipos-teste.js test` | Valida meta, autentica (`POST /auth`) e pede o link do catálogo (`GET /v2/catalog`). Mostra só resumo. |
| `node bin/saipos-teste.js catalog --download` | Igual ao `test` e baixa o catálogo para `catalogo-teste.json` (privado). |
| `node bin/saipos-teste.js prepare --item COD [--choice COD]... --payment-code COD [--payment-zero] [--senha N] [--item-note TXT]` | Gera **uma** ficha TICKET offline (nada é enviado). Códigos vêm do catálogo TESTE. |
| `node bin/saipos-teste.js send --order HML-... --sandbox` | Envia a ficha preparada (`POST /order`), uma única vez. |

Ficha gerada: `order_id` único `HML-…`, `customer {id:"-1", name:"TESTE"}`, `notes` `TESTE-NAO PRODUZIR | senha-nossa:N`, `ticket_reference` `TESTE-N`, `display_id` = nossa senha, 1 item com complementos (`aditional_price`, grafia oficial), 1 pagamento de teste (zero ou total conferido em centavos e enviado em reais). Sem endereço, CPF, telefone ou cliente real. Dados privados ficam ao lado do `.env`: `token-cache.json`, `catalogo-teste.json`, `payloads/`, `ledger/`.

## Testes (sem rede)

```
cd outputs/saipos-teste
node --test test/
```
Usam `fetch` falso com respostas no formato dos exemplos oficiais e credenciais fictícias em pasta temporária. Resultado conferido em 10/11/2026: 37 de 37 aprovados.

## Ensaio de UI real (10/11/2026)

Pedido apenas TESTE, enviado uma vez. Resultado: o pedido chegou à cozinha da Saipos (Ficha 1) e foi marcado como pronto pela UI. A ficha não foi impressa. Evidências em `outputs/`:
- `pedido-recebido-saipos-teste-10-11-2026.png`
- `pedido-cozinha-saipos-teste-10-11-2026.png`
- `detalhes-cozinha-saipos-teste-10-11-2026.png`
- `pedido-pronto-saipos-teste-10-11-2026.png`

Resposta 200 `{}` foi confirmada pela tela, mas a resposta não traz id Saipos: o vínculo é pelo `order_id` (nosso) e pela Ficha 1 vista na UI.

## Segurança

- Só `https://order-api.saipos.com`, só `/auth`, `/v2/catalog`, `/order`; sem redirect (3xx = falha).
- Download do catálogo: somente o link retornado pela API, em `saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com`, caminho `/catalog/catalog-<numero>.json`, HTTPS, sem portas alternativas ou redirecionamento.
- Segredo, token, `idPartner` e link do catálogo nunca são impressos; respostas de erro saem resumidas (`t`, `dateTime`, `errorMessage`, `guidRequest`).
- Token só no arquivo privado; reaproveitado até 30 min antes de expirar; no mínimo 30 s entre tentativas de `/auth` (política local).
- `send`: recusa sem `--sandbox`, sem meta válida, com arquivo adulterado (sha256) ou `codStore` diferente. A reserva em `ledger/` é criada **antes** do POST: uma tentativa por `order_id`, sem reenvio automático. Timeout, 5xx, 3xx ou erro de rede viram `ambiguo`.
- Vínculo item↔complemento é validado pelo conector (ids e descrições conferidos contra o catálogo).
- Nenhum pagamento é capturado; `payment_types` é só metadado de teste.

## Procedimento para caso ambíguo

Caso `ambiguo` (timeout, 5xx, 3xx ou erro de rede): **primeiro reconciliar pela UI** da loja TESTE, olhando se a ficha apareceu. **Nunca criar `order_id` novo automaticamente.** Só depois de decidir pela UI é que se roda `prepare` de novo, manualmente.

## Pedido Pronto x Retirada (tela própria)

Nesta ficha TICKET da loja de teste, o botão Pedido Pronto levou diretamente a Entregue. A tela própria precisa tratar **Pronto** e **Retirada** explicitamente e conferir o mapeamento da loja antes de ligar a TV. Na documentação de TICKET, os callbacks listados são `CONFIRMED`, `CONCLUDED`, `CANCELLED`.

## LIMITES

- Ensaio feito em uma loja TESTE, com um pedido. Não é homologação.
- Sem produção, lojas reais, impressão, cobrança, portal, ERP ou instalação. Sem alterar o Developer.
- **Ainda falta:** tela própria de prototipagem ainda NÃO está amarrada ao adaptador CLI; cardápio completo, adicionais e testes de valores ainda não feitos; pagamento real não implementado; webhook e TV não ligados.
- Unidade de `price` do catálogo não declarada: tratada como reais. Conferir o total mostrado por `prepare` contra a UI.
- Código da forma de pagamento depende do mapeamento do canal: `--payment-code` é obrigatório, sem default.
- `total_amount` não é enviado (opcional no TICKET pela doc).
- A senha da TV não é o número de venda da Saipos.
- Consulta e cancelamento **não implementados**: a doc não confirma que se aplicam a TICKET. Cancele a ficha de teste pela UI.
- Custo da API, taxas e liberação para produção **não confirmados**. Não há promessa de zero custo, suporte ou homologação.
- Fontes: documentação oficial da Saipos (`/reference/criar-pedido` e `/reference/consultar-cardapio`) e as provas de UI de 10/11/2026. Pesquisa completa em `docs/pesquisa-conexao.md`.
