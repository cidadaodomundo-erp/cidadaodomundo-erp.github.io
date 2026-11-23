# Tablets das mesas — Cidadão do Mundo (MODO TESTE)

Pedido na mesa pelo tablet (Redmi Pad SE 11"): o cliente escolhe os itens com adicionais e observação,
confirma a rodada, e a rodada aparece na **tela da cozinha de teste**. No modo `--sandbox` ela também vai
como ficha para a **loja TESTE do Saipos** ("Cidadão do Mundo - HML" [93936]). Nada é cobrado. Nunca usa loja real.

## O que tem aqui
| Pasta | O que é |
|---|---|
| `app/` | A tela do tablet (núcleo `src/core.js`, tela `src/app.js`, visual `src/style.css`), build do HTML avulso e testes. |
| `app/src/envio.js` | Só no modo servidor: manda a rodada ao servidor do salão (reenvio não duplica). |
| `servidor/` | Servidor do salão: entrega a tela do tablet, recebe rodadas, mostra a cozinha (`/cozinha`) e, no sandbox, envia ao Saipos TESTE. |
| `app/docs/` | O "livro" dos tablets (Redmi, Goomer, contrato Saipos mesa/comanda, revisões). |

O cardápio é a cópia do cadastro do totem (Gama/VNDX, 11/11/2026, 93 produtos com foto) que já está em
`totem/app/data`. O conector do Saipos é o mesmo do totem (`totem/saipos-teste`), sem mudanças.

Passo a passo simples para a equipe: [COMO-LIGAR-OS-TABLETS.md](COMO-LIGAR-OS-TABLETS.md) (atalhos `LIGAR-SALAO-TESTE.bat` e `LIGAR-SALAO-SAIPOS-TESTE.bat`).

## Recursos de salão
- **Paga antes (padrão):** ao confirmar, o tablet abre a tela de pagamento (QR Code para pagar no celular, ou Pix/Apple Pay/Google Pay/crédito/débito no próprio tablet). A rodada só vai para a cozinha e para o Saipos depois do pagamento **aprovado**. Recusado: tenta de novo; cancelado: nada é enviado e o carrinho fica. Pagar duas vezes não cobra nem duplica. **Hoje o pagamento é SIMULADO**; o real depende do e.Rede liberado pela Rede. `--pagar-na-saida` volta ao jeito antigo (paga no fim, na conta).
- Celular do cliente: `/pagar?t=<código>` (o QR leva até lá). No teste o celular precisa estar no Wi-Fi do salão; com o e.Rede o QR abre o checkout da Rede na internet.
- `/tablet?mesa=N` prende o tablet na mesa N. Trocar a mesa e fechar a conta no tablet pedem a **senha da equipe** (`SALAO_PIN` ou gerada no 1º uso em `servidor/dados/pin-equipe.txt`; 5 erros bloqueiam 1 minuto).
- Tablet mostra o andamento de cada rodada (Recebida, Preparando, Pronta, Entregue) e se libera sozinho quando a cozinha fecha a conta.
- `/cozinha`: só abre com a senha da equipe (vira um token guardado no aparelho). Fila de rodadas, avisos de atendente/conta, contas abertas com "Fechar conta".
- Senha da equipe gerada com 6 números; erros bloqueiam por aparelho (IP), com espera que dobra a cada bloqueio.
- Conta fechada por marca na rodada (nunca por relógio). O tablet pergunta pelas suas próprias rodadas (ids) e se libera quando todas foram fechadas.
- Saipos numa fila própria: o tablet recebe "enviando ao Saipos" na hora e o resultado aparece na cozinha.
- Resposta perdida (o servidor recebeu, o tablet não viu): o carrinho fica travado até o reenvio, que usa a mesma chave e não duplica.
- Com o carrinho vazio e sem toque há 2 min, o tablet recarrega a cada 20 min para pegar o cardápio/horário atual.
- Reiniciar o servidor não obriga recarregar os tablets (token guardado no estado).
- `--saipos-mesa`: manda para a MESA no Saipos (modo TABLE, `desc_table` = número da mesa, comanda em `desc_order_pad`). **Não homologado**: exige mesas cadastradas na loja TESTE; sem isso use o padrão (ficha).

## Como ligar (no computador do salão, com Node 18+)
```
node tablets/servidor/bin/start-salao.js --rede
```
Mostra os endereços. No tablet, abrir `http://<ip-do-computador>:4662/tablet`; na cozinha, `http://<ip>:4662/cozinha`.
Sem `--rede` só abre no próprio computador (`http://127.0.0.1:4662/tablet`).

Com a loja TESTE do Saipos (usa a mesma configuração privada do totem — `.env`, `test-store.json`, `gama-hml-map.json`, fora do repositório):
```
CONNECTOR_ENV_PATH=<caminho absoluto do .env privado> node tablets/servidor/bin/start-salao.js --sandbox --rede
```
No Windows (PowerShell): `$env:CONNECTOR_ENV_PATH="C:\...\.env"` antes do comando.

## Garantias
- Preço sempre calculado no servidor (o tablet não manda preço). Grupos obrigatórios, mínimo/máximo e horário do cadastro conferidos de novo no servidor.
- Rodada tem chave única: tocar "Confirmar" de novo depois de uma queda reenvia a mesma rodada e **não duplica** (nem na cozinha, nem no Saipos).
- Saipos: só a loja TESTE (UUID conferido antes de qualquer rede). Ficha TICKET com `display_id` a partir de 7001 (o totem usa 92xx), nota de cada item com "MESA 5 R2 | observação", pagamento `DIN` só como metadado. Falha/queda vira "Saipos a conferir" e **nunca** reenvia sozinho. Resposta 200 do Saipos só prova "recebido pela API".
- Tela não recebe segredo, token, idPartner, `order_id` nem códigos Saipos.
- POST só da mesma origem, com token por sessão do servidor, JSON, até 48 KB; cabeçalho Host conferido.
- Estado em arquivo JSON local (`servidor/dados/`, fora do git; no sandbox, ao lado do `.env` privado).

## Testes (sem rede, Saipos simulado)
```
cd tablets/app && node --test tests/*.mjs        # 50 (núcleo, Goomer, payload mesa/comanda)
cd tablets/servidor && node --test test/salao.test.js   # 16 (fluxo, pagar antes, senha, conta, login da cozinha, segurança, Saipos FAKE ficha e mesa)
```
HTML avulso (demonstração sem envio, cardápio inteiro): `node tablets/app/tools/build.mjs --completo`.

## O que falta para uso real
1. **Ensaio na loja TESTE de verdade**: rodar o `--sandbox` no computador que tem a configuração privada (hoje o BENTOIK) e conferir a ficha na tela do Saipos.
2. **Mesa de verdade no Saipos**: hoje vai como ficha (TICKET) com a mesa escrita na observação. Para cair na mesa/comanda certa (modo TABLE) falta cadastrar mesas/comandas na loja TESTE e ensaiar rodadas (POST × PUT, ver `app/docs/INTEGRACAO-SALAO.md`). O montador do pedido TABLE já existe em `app/src/saipos-payload.cjs`.
3. **Cardápio do salão** (Goomer 269560, 163 linhas) — hoje é o cardápio do totem.
4. **Teste no Redmi Pad SE** de verdade e modo quiosque (tela cheia, abrir sozinho).
5. Computador fixo ligado no salão (servidor) e Wi-Fi dos tablets.
6. Pedir conta vai só para a tela da equipe; fechar/pagar conta não existe na API do Saipos.
7. **Pagamento real (e.Rede)**: Rede liberar o e.Rede com Apple Pay/Google Pay e informar a taxa; depois trocar o simulado pelo checkout do e.Rede e lançar a forma de pagamento certa no Saipos.
