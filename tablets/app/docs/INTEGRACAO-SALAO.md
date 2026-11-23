# Integração do salão (mesa / cartão-comanda) — estado, contrato e pendências de homologação

**Nada é enviado.** Existe apenas um **adaptador puro offline** (`src/saipos-payload.cjs`) que monta payloads revisáveis a partir de dados fornecidos pelo chamador. Não há transporte, fetch, ambiente, token, relógio, nem ligação com o front ou o build. Tudo é **rascunho de contrato para HML, não homologado**.

## Fontes
- `docs/SAIPOS-CONFERENCIA-ATUAL.md`: conferência do coordenador no site oficial em 12/11/2026 (páginas `estrutura-campos-endpoints` e `criar-pedido`; somente leitura).
- `…/j-vou-fazer-mais-uma-pergunta/work/saipos-docs/` (documentação local: `criar-pedido.md`, `codigos-de-erro.md`, `consultar-pedido.md`, `eventos-pedido.md`, `rotinas-pdv.md`).
- `laboratorio-totem/docs/saipos-oficial.md`, `LIMITES.md` (contexto TICKET/HML).

## Contrato confirmado (o que o adaptador implementa)
- **POST /order, modo TABLE.** Obrigatórios: `order_id` (string, máx. 40), `display_id`, `cod_store`, `created_at`, `order_method.mode = "TABLE"`, `items`, `table`. `customer` e `payment_types` são opcionais na doc e **não são suportados** pelo adaptador (campo recusado). `total_*` não é enviado (a Saipos calcula).
- **Destino em `table`** (os 3 campos são opcionais na doc; o adaptador exige escolha explícita):
  - mesa → `table.desc_table`;
  - comanda → `table.desc_order_pad`;
  - `table.integration_code` da mesa só se o chamador o fornecer **e** marcar `integrationCodeConfirmado: true` (vem de cadastro real). Para comanda não está documentado → caso **recusado**.
  - `order_method.table_reference` (opcional) é só observação na Saipos.
  - Mesa e comanda nunca se misturam.
- **Itens:** a doc marca opcionais; o **nosso contrato exige** `codigo` (integration_code), `descricao`, `quantidade` (inteiro ≥ 1), `precoCentavos` (inteiro ≥ 0). Complementos exigem `codigo`, `descricao`, `quantidade`, `precoAdicionalCentavos` (`aditional_price`, grafia da API). Opcionais no POST: `observacao` (notes), `garcomId` (id_store_waiter).
- **PUT /order, modo TABLE (rascunho de adição).** Obrigatórios: `order_id`, `cod_store`, `order_method.mode`, `items` com `integration_code`, **`item_external_code`**, `desc_item`, `quantity`, `unit_price` (complementos com os 4 campos). `display_id`/`created_at` só entram se fornecidos. Não leva `table`.
- **Solicitar conta:** `PUT /order-status` com `order_id`, `cod_store`, `status = "CLOSE_REQUESTED"`. **Não é pagamento nem fechamento de venda.** O app continua simulando "Pedir conta" até haver homologação; o endpoint **existe e está documentado**.
- **Consulta de ocupação:** `GET /sale-status-by-table-or-pad` exige `table` OU `pad` (arrays em string). **Sem builder** (não pedido nesta etapa).
- **Dinheiro:** entrada em centavos inteiros; no corpo vira number em reais (`centavos/100`, testado de 0 a 2.000,00 sem imprecisão). Códigos são **strings literais** (zeros preservados; número JS recusado; sem trim silencioso).
- `desfecho`: `classificarDesfecho` é **consultivo**: `repetirAutomaticamente` é **sempre false**; sem resposta, sucesso não homologado ou erro não mapeado ⇒ **reconciliar**. Erros documentados (`codigos-de-erro.md`) só rotulam; rejeições claras (902, 906, 908, 910, 912, 916, 931, 932, 934) ficam com `reconciliar:false`, ainda sem reenvio automático.

## Pendências de homologação (HML; nada disto está resolvido)
1. **Rodadas: POST × PUT.** A doc de criação descreve rodadas por **POST** com mesmo `order_id` + `desc_table`/`desc_order_pad` (`criar-pedido.md:455`, `:519`); a conferência atual mostra também **PUT /order** com `item_external_code`. Qual vale, o que cada um faz (acrescenta? substitui?), e se o body da 2ª rodada leva só os itens novos ou todos: **ensaio em HML**.
2. **Idempotência:** nenhuma chave documentada. 904 (`ORDER_ALREADY_EXISTS`) manda usar novo `order_id`, o que conflita com "mesmo `order_id`" da adição. Resposta perdida pode duplicar itens. Estratégia de `order_id`/`item_external_code` por rodada, definida **junto com** a reconciliação (consulta de ocupação), **ainda não decidida**.
3. **Comanda ocupada (907)** × adição à mesma comanda: quando 907 ocorre é desconhecido; como o app distingue "minha comanda" de "ocupada por outro".
4. **Configuração real da loja** no Saipos: mesas/comandas cadastradas e seus identificadores (908/910/916), comandas ativas (932), comandas livres (934), mesa aberta manualmente (conversão). **Nenhuma faixa assumida**; `desc_table`/`desc_order_pad` devem vir do cadastro real; dizer se `table.integration_code` é necessário.
5. **`total_discount`** e outros campos que apareciam como obrigatórios em outros módulos/exemplos: confirmar em HML que **não** são exigidos em TABLE (a conferência lista só os acima).
6. **Códigos PDV** (`integration_code` de produto/complemento) ainda sem catálogo do salão extraído nem cruzado com a exportação da Saipos; `item_external_code` precisa de regra definida (origem e unicidade).
7. **Sucesso/resposta:** formato da resposta 2xx e dos erros de cada rota é desconhecido (o OpenAPI local mostra `{}`); `classificarDesfecho` trata como "não homologado".
8. **Credenciamento** (Secret/idPartner, loja de TESTE) não feito; custo da Order API não confirmado; **fechamento/pagamento** de mesa/comanda não são suportados pela API (`criar-pedido.md:460`, `:524`).
9. Garçom (`id_store_waiter`): obrigatório ou não, e origem do id (endpoint de garçons não lido).

## O que o app faz hoje (simulado)
- Modalidade **mesa (1–150)** ou **cartão/comanda (identificador, não é pagamento)**, confirmação do identificador, travado com consumo ativo. Cada rodada guarda `ocupacao`; status "Registrado nesta demonstração"; `localStorage` `cdm-tablet-demo-v1` com migração do estado anterior sem apagar rodadas válidas.
- Grupos: `obrigatorio` separado de `minimo` (ver `docs/GOOMER-EVIDENCIA-12-11.md`).
- **O adaptador não é chamado pelo app.** Os identificadores do app (mesa 1–150, cartão alfanumérico) **não** são os do cadastro Saipos até que a pendência 4 seja resolvida.
