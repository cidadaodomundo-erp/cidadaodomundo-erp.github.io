# Dicionário de campos — relatório de pedidos iFood

Base de referência para uso em relatórios e dashboards futuros. Campos organizados por grupo.

## 1. Identificação do pedido e da loja

| Campo | Descrição | Uso sugerido |
|---|---|---|
| ID COMPLETO DO PEDIDO | Código único do pedido (UUID). | Chave primária da tabela — nunca se repete. |
| NOME DA LOJA | Nome da loja/unidade. | Filtro de loja. |
| ID DA LOJA | Código único da loja. | Chave para relacionar com a tabela de lojas (dim_lojas). |
| ID CURTO DO PEDIDO | Número curto do pedido, repete entre lojas/dias. | Só para busca humana de um pedido específico — não é chave única. |

## 2. Data, turno e período

| Campo | Descrição | Uso sugerido |
|---|---|---|
| DATA E HORA DO PEDIDO | Data e hora exata em que o pedido foi feito. | Base para filtros de dia, mês, hora. |
| TURNO | Faixa do dia em que o pedido ocorreu (madrugada, almoço, café da tarde, jantar). | Filtro de turno. |
| SEMANA *(novo campo criado)* | Semana do pedido no formato "nº da semana + data inicial (segunda) + data final (domingo)", ex. `30 20/07 (inicial) - 26/07 (final)`. Semana sempre de segunda a domingo. | Filtro de período semanal, comparação semana a semana. |
| DIA DA SEMANA *(novo campo criado)* | Dia da semana do pedido, em português (SEGUNDA, TERÇA, QUARTA, QUINTA, SEXTA, SÁBADO, DOMINGO). | Filtro por dia da semana, análise de sazonalidade (ex. fins de semana vs. dias úteis). |

## 3. Canal, entrega e forma de pagamento

| Campo | Descrição | Uso sugerido |
|---|---|---|
| FORMA DE PAGAMENTO | Como o cliente pagou (via app, na entrega, vale, etc.). | Análise de mix de pagamento. |
| TIPO DE PAGAMENTO *(novo campo criado)* | Simplificação da forma de pagamento em `ONLINE` ou `CARTAO`. Regras: contém "Pgto via APP" → `ONLINE`; contém "Pgto na Entrega" → `CARTAO`; "Outros vales" → `ONLINE`; "Voucher" → `ONLINE`; "Dinheiro" → `CARTAO`; "Pagamento via restaurante" → `CARTAO`. ⚠️ Sempre que aparecer uma forma de pagamento nova que não se encaixe nessas regras, o campo fica em branco e devo alertar antes de seguir. | Filtro simplificado de pagamento online vs. na entrega. |
| TIPO DE ENTREGA | Sempre "ENTREGA" nesta base (sem retirada no local). | Pouca variação — confirmar se retirada aparece em outras exportações. |
| PRODUTO LOGISTICO | Quem faz a entrega: `ENTREGA PROPRIA` (entregador da loja), `SOB DEMANDA ON`/`SOB DEMANDA OFF` (entregador do iFood, dentro/fora do expediente contratado). | Análise de custo e desempenho por tipo de logística. |
| CANAL DE VENDA | `iFood` (marketplace) ou `Sob Demanda` (loja usa só a logística do iFood, pedido não veio do marketplace). | Segmentar receita por canal. |

## 4. Status e cancelamento

| Campo | Descrição | Uso sugerido |
|---|---|---|
| STATUS FINAL DO PEDIDO | `CONCLUIDO`, `CANCELADO` ou `CANCELAMENTO PARCIAL`. | Base de todos os filtros de status; já validamos as regras de cálculo financeiro para cada um. |
| TIPO DE CANCELAMENTO | Total ou parcial (redundante com o status, mas explícito). | Cross-check de status. |
| MOTIVO DO CANCELAMENTO | Motivo declarado do cancelamento. | Relatório de causas de cancelamento. |
| ORIGEM DO CANCELAMENTO | Quem cancelou: `MERCHANT` (loja), `CLIENTE`, `LOGISTICS` (logística/entregador). | Indicador de responsabilidade por cancelamento. |
| DATA DO CANCELAMENTO | Quando o cancelamento ocorreu. | Tempo entre pedido e cancelamento. |
| VALOR DOS ITENS CANCELADOS | Valor dos itens removidos em cancelamento parcial. | Já usado na fórmula de Faturamento Bruto. |
| CANCELAMENTO É CONTESTAVEL | Indica se a loja pode contestar o cancelamento junto ao iFood. | Gestão de contestações. |
| MOTIVO DA IMPOSSIBILIDADE DE CONTESTAR | Motivo pelo qual não é possível contestar. | Complementa o campo anterior. |
| PEDIDO ACEITO PELA LOJA | Confirmação de que a loja aceitou o pedido. | Indicador de operação (aceite/recusa). |

## 5. Valores financeiros

| Campo | Descrição | Uso sugerido |
|---|---|---|
| VALOR DOS ITENS (R$) | Valor dos produtos do pedido. | Base do cálculo de faturamento. |
| TOTAL PAGO PELO CLIENTE (R$) | Total que o cliente pagou (itens + entrega + serviço, com descontos já aplicados). | ⚠️ **Não utilizar em cálculos financeiros** (definição do time). Manter no banco apenas como referência/consulta. |
| TAXA DE ENTREGA PAGA PELO CLIENTE (R$) | Frete pago pelo cliente. | Compõe o Faturamento Bruto. |
| INCENTIVO PROMOCIONAL DO IFOOD (R$) | Desconto custeado pelo iFood. | Card "iFood". |
| INCENTIVO PROMOCIONAL DA LOJA (R$) | Desconto custeado pela loja. | Card "Promos" e desconto no cálculo do Líquido. |
| INCENTIVO PROMOCIONAL DA REDE (R$) | Desconto custeado pela rede/franquia. | Conta como dinheiro NOSSO, junto com o da loja (card "Promos" e desconto no Líquido) — corrigido em 07/11/2026, auditoria canal-24. |
| TAXA DE SERVIÇO (R$) | Taxa de serviço cobrada no pedido. | Ainda não usada nas fórmulas atuais — avaliar se compõe algum card. |
| TAXAS E COMISSOES (R$) | Comissão cobrada pelo iFood sobre o pedido. | Card "Taxas e comissões" e parte do cálculo do Líquido. |
| VALOR LIQUIDO (R$) | Valor líquido calculado pelo iFood para o pedido. | Usamos nossa própria fórmula validada; útil como conferência cruzada. |
| FRETE COBRADO DO RESTAURANTE (APENAS SOB DEMANDA) (R$) | Frete que a loja paga quando usa entrega "sob demanda". | Custo de logística para pedidos sob demanda. |

## 6. Agendamento

| Campo | Descrição | Uso sugerido |
|---|---|---|
| PEDIDO AGENDADO | Se o pedido foi agendado para horário futuro (nesta base, sempre "NÃO"). | Relatório de pedidos agendados quando existirem. |
| DATA DE AGENDAMENTO | Data/hora agendada, se aplicável. | Complementa o campo anterior. |

## 7. Logística e tempos de entrega

| Campo | Descrição | Uso sugerido |
|---|---|---|
| AGRUPAMENTO DE ROTA | Se a entrega foi `INDIVIDUAL` ou `AGRUPADA` (mesmo entregador levando vários pedidos). | Eficiência logística. |
| PRIORIDADE DO PEDIDO | Prioridade de despacho (nesta base, sempre "PADRÃO"). | Pouca variação por ora. |
| TEMPO DE PREPARO DO PEDIDO (MIN) | Tempo entre aceite e pedido ficar pronto. | Indicador operacional de cozinha. |
| TEMPO DE ALOCAÇÃO DO ENTREGADOR (MIN) | Tempo até um entregador ser designado. | Indicador de disponibilidade de frota. |
| TEMPO DE ACIONAMENTO DO BOTÃO PRONTO (MIN) | Tempo até a loja marcar o pedido como pronto. | Indicador operacional de cozinha. |
| TEMPO DO ENTREGADOR À CAMINHO DA LOJA (MIN) | Tempo de deslocamento do entregador até a loja. | Indicador logístico. |
| TEMPO DO ENTREGADOR ESPERANDO NA LOJA (MIN) | Tempo de espera do entregador na loja. | Indicador operacional — tempo de espera pode indicar atraso da cozinha. |
| TEMPO DO ENTREGADOR À CAMINHO DO CLIENTE (MIN) | Tempo de deslocamento até o cliente. | Indicador logístico. |
| TEMPO DO ENTREGADOR ESPERANDO NO CLIENTE (MIN) | Tempo de espera na entrega ao cliente. | Indicador de experiência de entrega. |
| TEMPO PROMETIDO DE ENTREGA (MIN) | Prazo prometido ao cliente. | Base de comparação para SLA. |
| TEMPO DA ENTREGA REALIZADA (MIN) | Tempo total real do pedido até a entrega. | Métrica de SLA cumprido. |
| TEMPO DE ATRASO EM RELAÇÃO AO TEMPO PROMETIDO DE ENTREGA (MIN) | Diferença entre prometido e realizado. | Indicador direto de atraso — ótimo para dashboard de SLA. |
| DISTÂNCIA PERCORRIDA ATÉ O CLIENTE (KM) | Distância real percorrida. | Análise de raio de entrega. |
| DISTÂNCIA CONSIDERADA NA COTAÇÃO | Faixa de distância usada para cotar o frete (ex. "2-3 km"). | Análise de precificação de frete. |
| DISTÂNCIA CONSIDERADA NA COTAÇÃO (APENAS SOB DEMANDA) | Mesma faixa, específica para pedidos "sob demanda". | Idem, para esse canal. |
| CONFIRMAÇÃO DE ENTREGA PRÓPRIA | Confirmação de entrega quando a loja usa entregador próprio (vazio nesta base). | Avaliar quando a loja tiver frota própria. |

## 8. Negociações com o cliente (antes e depois da entrega)

| Campo | Descrição | Uso sugerido |
|---|---|---|
| ORIGEM DA NEGOCIAÇÃO NO PREPARO | Quem iniciou uma negociação durante o preparo (nesta base, sempre o cliente). | Indicador de solicitações do cliente durante o preparo. |
| TIPO DE NEGOCIAÇÃO NO PREPARO | O que o cliente pediu: desistir do pedido, adicionar observação, alterar itens. | Relatório de tipos de solicitação. |
| CLIENTE SOLICITOU NOVA PREVISÃO DE ENTREGA DEVIDO ATRASO (LOGÍSTICA PRÓPRIA) | Se o cliente pediu novo prazo por atraso (entrega própria). | Indicador de insatisfação com atraso. |
| RESPOSTA DA LOJA A SOLICITAÇÃO DE NOVA PREVISÃO DE ENTREGA PRÓPRIA | Novo prazo (em minutos) proposto pela loja. | Complementa o campo anterior. |
| RESPOSTA DO CLIENTE SOBRE A NOVA PREVISÃO DE ENTREGA PRÓPRIA | Se o cliente aceitou o novo prazo ou não respondeu. | Taxa de aceite de renegociação. |
| CLIENTE INFORMOU PROBLEMA EM PEDIDO APÓS A ENTREGA | Se o cliente reportou problema pós-entrega. | Indicador de qualidade pós-entrega. |
| RESPOSTA DA LOJA SOBRE PROBLEMA EM PEDIDO APÓS ENTREGA | Como a loja respondeu: propôs negociação, preferiu cancelar, discordou. | Indicador de atendimento pós-venda. |
| NEGOCIAÇÃO ENVIADA PELA LOJA AO CLIENTE APÓS A ENTREGA | O que a loja ofereceu: reenvio do item ou reembolso. | Custo de reparação pós-venda. |
| RESPOSTA DO CLIENTE NA NEGOCIAÇÃO APÓS A ENTREGA | Se o cliente aceitou, a proposta expirou ou foi rejeitada. | Taxa de resolução de problemas pós-venda. |

---

**Observação sobre esta base de teste:** os campos dos grupos 6, 7 e 8 têm muitos valores em branco porque só se aplicam a pedidos com determinadas condições (agendamento, entrega própria, ou reclamação do cliente). Isso é esperado — o volume de dados preenchidos deve crescer conforme mais exportações forem importadas.
