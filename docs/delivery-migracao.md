# Migração do Delivery para o portal novo (12/11/2026)

Pedido do Fabio. Só arquivos locais do frontend: nada publicado, nada de git nem de banco.

## Correção desta revisão (12/11/2026)

A etapa anterior pôs no setor Delivery três atalhos externos para o portal antigo (`antigo:chegada`, `antigo:fila`,
`antigo:escala`), abrindo `cidadaodomundo.github.io` em outra aba, e ampliou `visivel()` para liberar esses links por
chave. **Isso estava errado**: os botões do Sistema operacional do Fábio devem funcionar dentro do portal novo.

Corrigido nesta revisão:

- Os 3 atalhos foram removidos de `casca/setores-fabio.js`, com as chaves, a configuração (`atalhos`,
  `autorizavelPorChave`, `nota`) e as palavras de busca deles.
- `sistema.html`: removido o código que criava itens a partir dos atalhos e o uso de `nota` nos cartões;
  `visivel()` voltou à regra anterior para links (`if (it.link) return false;` em acesso restrito). O link legado do
  Neto fora do agrupamento (`link:portal-qualidade`) não foi tocado.
- Nenhuma aba do Delivery foi remapeada para substituir os atalhos: a aba "Chegada do dia" é leitura parcial e não
  faz o papel da Chegada completa.
- No setor Delivery fica só o **Delivery do dia** (nativo), com um aviso em texto, sem botão nem link: Chegada
  completa, Fila de pedidos e edição da Escala estão em migração. O mesmo aviso, em texto, está no fim de
  `delivery/index.html`.

## O que existe hoje no portal novo

| O quê | Onde | Situação |
|---|---|---|
| Setores dentro do agrupamento **Sistema operacional do Fábio** (`id: 'outras'`): Delivery, Salão, RH, Cozinha e encomendas, Manutenção e compras, Gestão e lojas, Demais telas | `casca/setores-fabio.js`, `sistema.html` (`outrasTelas()` / `setoresDe()`) | Só apresentação. A lista do agrupamento é a sobra inteira; nenhuma tela saiu. Módulos do Neto, junções e hashes intactos. Ponto ao Vivo (`pao`) no RH. |
| `delivery` → `delivery/index.html` | `casca/paginas.js` | Delivery do dia. Já consultam dados (`delivery_dia`): Placar, Tempo de entrega, Cancelamentos, Avaliações do dia. Leitura parcial, em construção: Chegada do dia (só atividade registrada nas entregas, não é chegada nem saída real) e Escala (só consulta). |
| `salao`, `reservas`, `pausados` | `casca/paginas.js` | Rotas no setor Salão (Reservas e Pausados religados em outro chat; preservados). |

## Em migração (sem tela neste portal, sem botão, sem link externo)

- **Chegada completa dos motoboys** (entrada combinada, chegada, saída registrada, tempo registrado, garantido e
  refeição com estado e motivo). O coordenador está verificando a fonte correta antes de migrar. Não simular;
  garantido e refeição não são calculados nem mostrados no portal novo.
- **Fila de pedidos** e **edição da Escala do Delivery**: fontes e permissões ainda a verificar.

Nenhum backend novo foi criado para isso: nenhuma tabela, função, RPC, robô, coletor ou agendamento.

## Permissões

- `visivel()`/`PODE`/`painel_acesso` com a mesma regra de antes da etapa anterior. Conta restrita vê `delivery`,
  `salao` etc. só se a chave estiver na lista dela; links (`it.link`) somem para acesso restrito.
- Conta irrestrita vê tudo, como antes.

## Telas do agrupamento com integração pendente

Telas do agrupamento sem linha em `casca/paginas.js` aparecem **sem botão ativo**, com "integração pendente · acesso
ainda não conectado"; o endereço `#chave` cai no agrupamento (nunca a moldura `dashboard.html`).

## Testes

`casca/setores-fabio.test.js` (node --test, sem rede): agrupamento e setores, rotas (incluindo Reservas/Pausados),
nenhum link para o portal antigo e nenhuma chave `antigo:*` no agrupamento, permissões, junções, hash, sem RPC nova e
sem polling novo. Os testes que comparavam com git/uma base antiga foram removidos; o diff desta revisão é auditado
manualmente pelo coordenador.
