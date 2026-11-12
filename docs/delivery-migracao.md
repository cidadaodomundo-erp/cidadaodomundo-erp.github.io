# Migração do Delivery: portal antigo → portal novo (etapa 1, 12/11/2026)

Pedido do Fabio. Base: este repositório em `96e003ff53250a4076356736671ae24e11b30b6d`. Referência só de leitura:
`../antigo-atual` (portal antigo, `cidadaodomundo.github.io`), sem nenhuma alteração. Só frontend local, sem publicar.

## Nenhum robô alterado

Nenhum robô, tarefa, agendamento, coletor, rotina, credencial, banco, tabela, função ou RPC foi criado, ativado ou
alterado. `.github/workflows/` não mudou. A casca não chama nenhuma RPC nova (o teste confere). O Delivery do dia continua
com a mesma leitura (`delivery_dia`) e o mesmo timer de 5 min que já tinha; nenhum polling novo.

## O que foi integrado

| O quê | Onde | Situação |
|---|---|---|
| Setores dentro do agrupamento **Sistema operacional do Fábio** (`id: 'outras'`): Delivery, Salão, RH, Cozinha e encomendas, Manutenção e compras, Gestão e lojas, Demais telas | `casca/setores-fabio.js`, `sistema.html` (`outrasTelas()` / `setoresDe()`, menu lateral e cartões) | Só apresentação. A lista do agrupamento continua a sobra inteira; nenhuma tela saiu. Módulos do Neto (`casca/modulos.js`), `menu.js`, `busca.js`, junções e hashes intactos. Ponto ao Vivo (`pao`) fica no setor RH deste agrupamento. |
| Rota `delivery` → `delivery/index.html` | `casca/paginas.js` | Abre na moldura própria; segue a loja do topo (`CASCA_TELAS_POR_LOJA`). |
| Rota `salao` → `salao/index.html` | `casca/paginas.js` | Página já existente, marcada **Em construção** por ela mesma. |
| Bloco "o que já está aqui / o que ainda está no portal antigo" | `delivery/index.html` | Texto fixo, sem link, sem leitura nova. |
| Atalhos para telas antigas ainda necessárias (setor Delivery) | `casca/setores-fabio.js` | Link externo, outra aba, `noopener,noreferrer`, sem token nem parâmetro; não é moldura nem embed. **Não são migração.** |

Painel do dia nativo (já consulta dados, `delivery_dia`): Placar, Tempo de entrega, Cancelamentos, Avaliações do dia.
Leitura parcial, em construção: Chegada do dia (só atividade registrada nas entregas — não é chegada nem saída real) e
Escala do Delivery (só consulta).

## O que fica no portal antigo (atalho no setor Delivery)

| Atalho (chave) | Tela antiga | Por que fica |
|---|---|---|
| `antigo:chegada` | `chegada/index.html` — Motoboys rodando no dia | Contrato do `AGENTS.md` do portal antigo: entrada combinada, chegada observada, saída registrada, tempo registrado, garantido e refeição separados, com estado e motivo, fontes na ficha, lacres e Prova Real da Hellen. Nada disso foi recriado aqui; garantido/refeição **não** aparecem no painel novo. |
| `antigo:fila` | `fila/index.html` — Mapa de Pedidos | Tela de balcão ao vivo, não migrada. |
| `antigo:escala` | `delivery/escala.html` — Escala do Delivery | Edição da escala; aqui é só consulta. |

`mapa/index.html` do portal antigo é o "Mapa do Sistema" (não é tela de delivery) e não ganhou atalho; o mapa de
pedidos é o `fila/`. Também continuam só no antigo: `delivery/index.html` (Central do Delivery), `delivery/central.html`,
`delivery/checkin.html`, `delivery/qr.html`, `motoboys/` (cadastro MEI/CNH), `hellen/`.

## Permissões

- Nada mudou em `visivel()`/`PODE`/`painel_acesso` para as telas existentes.
- Conta restrita vê `delivery`/`salao` só se a chave estiver na lista dela (como antes).
- Atalho `antigo:*` para conta restrita: só se **a própria chave do atalho** estiver na lista. Ter `delivery` não libera
  atalho. Os links antigos do Neto (`link:portal-qualidade`, `link:promos.html`) continuam sumindo para acesso restrito.
- Conta irrestrita vê tudo, como antes.

## Telas do agrupamento com integração pendente

`reuniao`, `reservas`, `pausados`, `cozinha`, `tvs`, `pcartao`, `peventos`, `freelas`, `manutencao`, `prestadores`,
`mercadolivre`, `encomendas` estão no menu e várias têm arquivo de página neste repo, mas o acesso pela casca ainda não
está conectado (sem linha em `casca/paginas.js`): antes abriam a moldura `dashboard.html` (hoje só um redirecionamento,
que numa moldura mostra "esta tela mudou de lugar"). Agora aparecem **sem botão ativo**, com "integração pendente ·
acesso ainda não conectado"; o endereço `#chave` cai no agrupamento.

## Pendências concretas

1. Chegada (Motoboys rodando no dia): migração não realizada nesta etapa. Antes de migrar com o contrato inteiro do
   `AGENTS.md` antigo, verificar no ERP as fontes e permissões (chegada, batidas de saída, decisões de garantido/refeição
   com motivo, lacres) — o banco não foi auditado nesta etapa. Não simular. Só então retirar `antigo:chegada`.
2. Mapa de Pedidos (fila) e edição da Escala: migração não realizada nesta etapa; fontes e permissões no ERP ainda
   precisam ser verificadas.
3. Conectar o acesso das telas com integração pendente (lista acima), uma a uma, depois de conferir cada página; para
   `pcartao` e `peventos` falta também o `pessoas/index.html` registrar a tela (hoje só tem `pao`). Não feito nesta etapa.
4. Se alguma conta restrita precisar dos atalhos antigos: incluir a chave `antigo:chegada` / `antigo:fila` /
   `antigo:escala` na lista dela (`painel_acesso`) — decisão do dono, fora desta etapa.
5. Isolamento por filial do `delivery_dia` depende das regras do banco e não é verificado pela página (já anotado nela).
6. `pessoas/ponto-cartao.test.js` na base: 34 passam, 1 falha porque a rota e a integração de `pcartao` já estavam
   ausentes antes desta etapa. Esse módulo não foi alterado aqui. A organização vale como o dono determinou: tudo
   dentro do agrupamento `id: 'outras'`.

## Testes executados

```
node --test casca/setores-fabio.test.js delivery/operacao.test.js delivery/operacao-dados.test.js pessoas/ponto-ao-vivo-integracao.test.js
```

Resultado: 55 testes passaram, entre eles os 8 novos de `casca/setores-fabio.test.js`. O teste que usa git foi
reexecutado com `safe.directory` passado no próprio comando.
