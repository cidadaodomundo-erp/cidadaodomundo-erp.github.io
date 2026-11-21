# Continuidade — tablet de mesas no Redmi Pad SE 11" (12/11/2026)

## Descobertas (origem: informadas pelo coordenador/Fabio; a UI do Goomer NÃO foi vista por mim)
- Dispositivo principal do app novo: **Redmi Pad SE 11"** (não o Galaxy Tab A11).
- Goomer, dashboard da loja 269560, Gestão de Dispositivos, conferido em 12/11 nas 3 páginas: **21 registros** = 19 Xiaomi `23073RPBFG` (app 2.10.17), 1 Samsung `SM-X115`, 1 Amazon `KFONWI`. A UI mostra versão do app, **não** Android nem RAM.
- Goomer cardápio (loja 269560): **163 linhas** no total, **11 indisponíveis**, **18 invisíveis** (categorias diferentes; não somar como 29 distintos).
- Produto Nelson Piquet (id Goomer 177815), só leitura: categoria 21975; descrição "Pão brioche, burger de carne, maionese de cebolinha e mozarela."; variação "Nelson Piquet" PDV 1713633, preço 33,99. Nada salvo/publicado/enviado.

## Busca de snapshot completo do salão (leitura local, 12/11)
Lido nos caminhos autorizados; **não existe snapshot completo** com grupos/preços/PDV/variações/fotos/horários do salão.

| Caminho | O que há de fato |
|---|---|
| `Codex/2026-11-09/vam/work/pacote-claude/goomer-av-tela-real-09-11.json` | Origem "interface Goomer AV", `coletadoEm` 2026-11-10T02:25:30Z, unidade Água Verde. 163 linhas, **só** campos `n` (nome), `d` (Disponível/Indisponível), `v` (Visível/Invisível). Contagem nesse arquivo: 13 indisponíveis e 20 invisíveis (difere do 11/18 de 12/11, o que mostra que muda). Sem preço, variação, PDV, grupos, fotos ou horários. |
| `Codex/2026-11-06/.../claude-memory-2026-11-06/areas/goomer-proprio-cdm.md` e `tv-autoatendimento-av.md` | Só intenções/contexto (pedido na mesa caindo na comanda certa do Saipos); sem catálogo. |
| `caderno-preservado-11-11-2026/.../00-TOTEM-CARDAPIO-TV-11-11.md` | É sobre o **totem (Gama/VNDX)**: cópia 11/11 04:42Z, 20 categorias, 93 produtos, 107 variações (a amostra do app vem daqui). Não é o cardápio do salão. |
| `DeepSeek-Construcao/robo-goomer-saida.txt` (leitura anterior) | Só contagens por rodada (até 30/09). |

Também conferido: os `goomer-explorar/*.json` só trazem navegação do painel.

## Decisão
- **Catálogo completo do salão NÃO foi importado.** O app continua como **protótipo com amostra do totem (8 produtos VNDX)**, explicitamente rotulado; nenhum código PDV ou preço do salão foi inferido.
- Para importar de verdade falta uma **extração do painel Goomer 269560** (por produto: id, nome, categoria, descrição, foto, variações com código PDV e preço, perguntas/opções com mín/máx, pausado/escondido, horários), feita por quem tem a sessão autenticada, **cruzada com o Saipos** para preços/códigos. Esse arquivo deve ter formato definido (ex.: `data/goomer-salao-269560.json`) com `coletadoEm`; o `tools/build.mjs` pode ganhar um modo que o leia no lugar do snapshot do totem. Só depois de existir e ser validado.
- Pares pai.filho de PDV exigem validação no Saipos (regra do livro, no README).

## Mudança de layout feita (Redmi 11")
Reduzido o tamanho de tudo mantendo controles interativos em 48px: faixa de demonstração de 22px, cabeçalho de uma linha (logo 40px, mesa, busca), fonte base 15px, cartões de produto menores (grade mín. 170px, foto 16:10), modal com foto até 170px, comanda lateral de 340px. Duas colunas a partir de 840px de largura CSS (horizontal); abaixo disso (vertical) a comanda abre como painel por uma barra inferior. Identidade mantida: Cubano em títulos ASCII, Barlow, #111/#F4EBDD/#E0A81C, logo oficial.
**Não verificado visualmente** (sem navegador/dispositivo aqui): a largura CSS real do Redmi Pad SE (1920×1200 px físicos) depende do zoom/densidade do Chrome; o ponto de quebra 840px é uma estimativa a conferir.

## Resultado / pendências
- Antes desta mudança: build OK e 9 testes passaram (informado pelo coordenador).
- Esta mudança só mexeu em `src/style.css`, `src/app.js` (um valor de media query), `src/index.template.html` (atributos do logo) e docs. **Precisa de novo `node tools/build.mjs` e `node --test tests/`**, e conferir no navegador.
- Nenhuma publicação, sincronização, pedido, rede, banco, ERP ou operação real.
