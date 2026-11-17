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
cd tablets/servidor && node --test test/salao.test.js   # 9 (fluxo, segurança, cozinha, Saipos FAKE)
```
HTML avulso (demonstração sem envio, cardápio inteiro): `node tablets/app/tools/build.mjs --completo`.

## O que falta para uso real
1. **Ensaio na loja TESTE de verdade**: rodar o `--sandbox` no computador que tem a configuração privada (hoje o BENTOIK) e conferir a ficha na tela do Saipos.
2. **Mesa de verdade no Saipos**: hoje vai como ficha (TICKET) com a mesa escrita na observação. Para cair na mesa/comanda certa (modo TABLE) falta cadastrar mesas/comandas na loja TESTE e ensaiar rodadas (POST × PUT, ver `app/docs/INTEGRACAO-SALAO.md`). O montador do pedido TABLE já existe em `app/src/saipos-payload.cjs`.
3. **Cardápio do salão** (Goomer 269560, 163 linhas) — hoje é o cardápio do totem.
4. **Teste no Redmi Pad SE** de verdade e modo quiosque (tela cheia, abrir sozinho).
5. Computador fixo ligado no salão (servidor) e Wi-Fi dos tablets.
6. Pedir conta vai só para a tela da equipe; fechar/pagar conta não existe na API do Saipos.
