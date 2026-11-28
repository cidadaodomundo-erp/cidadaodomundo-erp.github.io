# Ponte HML — tela do app → Saipos (loja TESTE) — 11/11

Servidor separado do simulador, só para a loja de teste "Cidadão do Mundo - HML". Inclui cozinha e TV locais de teste; sem produção, webhooks, pagamento real ou sincronização de preparo com o Saipos.

## Estrutura
- `src/saipos-hml.js` — `criarServidorHml({ envPath, fetchImpl, timeoutMs })` (async, retorna `http.Server` não iniciado; `listen` só em 127.0.0.1).
- `bin/start-saipos-hml.js` — início manual (porta 4654).
- `public/saipos.html`, `public/saipos.js` — tela (reusa `estilo.css`).
- `test/saipos-hml.test.js` — testes offline.
- Depende (sem alterar) de `../saipos-teste/src/{config,http,auth,catalogo,payload,envio,arquivos,erros}.js`.

## Comandos
Testes (sem rede, credenciais FAKE em pasta temporária):
```
cd outputs/laboratorio-totem
node --test test/saipos-hml.test.js
```
Iniciar (manual; `CONNECTOR_ENV_PATH` absoluto, fora de `outputs/`):
```
$env:CONNECTOR_ENV_PATH="<caminho absoluto do .env privado>"
node bin/start-saipos-hml.js --sandbox
```
Imprime só `http://127.0.0.1:4654/`. Ctrl+C encerra; encerra sozinho em 2 h.

## Garantias
- Exige `codStore` = `ef2dc467-a4a8-4734-a4d7-eb3442ff3401` além de storeId/ambiente/nome (verificado antes de qualquer rede).
- No início: autentica, baixa e valida o catálogo real; falha ⇒ não sobe (nada é simulado).
- Só produto `40101353`, quantidade 1, preço 0, sem adicionais/remoções; qualquer divergência ⇒ 400.
- Pagamento `DIN`, com valor 0, apenas como metadado. Código conferido no canal HML e no ensaio integrado. Notes `TESTE-NAO PRODUZIR`.
- Senha: contador próprio a partir de 9201 (9101 já usada, nunca reenviada).
- Idempotência: chave UUID (localStorage antes do POST). Reserva persistente antes de preparar/enviar; fila serial; mapeamento chave→orderId gravado antes do envio em `ui-hml-state.json` (ao lado do .env privado, fora de `outputs/`).
- Mesma chave+mesmo pedido ⇒ mesmo resumo, sem novo POST; mesma chave+pedido diferente ⇒ 409.
- Timeout/5xx/interrupção/reinício ⇒ `ambiguo`/`bloqueado`; nunca reenvio automático. O helper do conector também protege com ledger.
- Resposta 200 `{}` só significa "recebido pela API"; a UI não afirma que chegou à cozinha — conferir na loja de teste.
- Proteções HTTP: Host exato, Origin exato, Sec-Fetch-Site cross-site bloqueado, Content-Type JSON, 16 KB, token CSRF por instância, CSP `default-src 'self'`, `no-store`, `Referrer-Policy: same-origin`, sem CORS.

## Cozinha + TV de teste (HML)
Páginas: `/cozinha-hml.html` (botões "Marcar pronto" / "Marcar retirado") e `/tv-hml.html` (colunas Preparando, Pronto para retirar, Últimas retiradas — 10). Arquivos: `public/{cozinha-hml,tv-hml}.{html,js}`, `public/tv-hml.css`, `test/tv-hml.test.js`.

**Escopo (importante):** a TV acompanha os comandos da NOSSA cozinha de teste. Nada de pronto/retirado é enviado ao Saipos, e não há sincronização automática: no ensaio TICKET o "pedido pronto" virou Entregue e não há callback de pronto documentado, então não se infere pronto de nenhum status do Saipos.

- Estado de preparo (`PREPARANDO` → `PRONTO` → `RETIRADO`) é separado do estado de envio. Só pedidos com envio `aceito` entram (inicial `PREPARANDO`); ambíguo/recusado/não enviado nunca aparecem nem aceitam ação.
- Pedidos aceitos antigos (sem campo) migram para `PREPARANDO` ao subir, mantendo senha e contador, sem novo POST. Gravado no mesmo `ui-hml-state.json` (fora de `outputs/`). Estado de preparo inválido ⇒ não sobe e não sobrescreve.
- `GET /api/hml/preparo`: só senhas, tempos e id público do nosso pedido (sem cliente, chaves, orderId, link). TV e cozinha fazem uma consulta por vez, com limite de 4 s, e aguardam 1,5 s depois de terminar para consultar novamente. Na falha, limpam as senhas e mostram "Sem conexão com a cozinha de teste". A cozinha recupera a proteção de acesso após reconexão e preserva a chave do comando em resultado incerto.
- `POST /api/hml/preparo/<id>/pronto|retirado` com `{ "actionKey": "<uuid>" }`: mesmas proteções (Host, Origin, CSRF, JSON, 16 KB), fila serial, gravação atômica antes de responder. Mesma `actionKey` repete o resultado; ação igual já efetivada retorna o estado sem novo evento; retirado antes de pronto ⇒ 409 sem alterar.
- Nenhuma ação chama `/order` nem qualquer API; o menu/payload/restrição Diversos 0 não foram alterados.

Testes: `node --test test/` (inclui `test/tv-hml.test.js`).

## Limites
Um único produto/ensaio; sem carrinho real, sem sync com o Saipos, sem TV física, sem produção/webhooks. "Fazer novo pedido de teste" só aparece após recusa/não envio e é ação explícita.
