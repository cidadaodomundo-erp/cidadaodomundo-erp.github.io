# Resultado: abertura do app pelo Chrome (12-11)

Manifesto: TESTE_ISOLADO, pasta cwd sem remoto/banco empresarial. Saipos somente HML (storeId 93936, uuid ef2dc467-a4a8-4734-a4d7-eb3442ff3401). Reserva 148 chat-totem-mouse-12-11 do coordenador.

## Bug medido (pelo coordenador)
GET `/` com `Host: 127.0.0.1:4654`, `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document` retornava 403 `origem_invalida` antes do HTML. `same-origin` funcionava.

## Causa
Em `src/saipos-hml.js`, a checagem de `Sec-Fetch-Site` rejeitava qualquer valor diferente de `same-origin`/`none`, antes do roteamento de estaticos.

## Correcao minima
`src/saipos-hml.js` (funcao `tratar`):
- URL/pathname passam a ser parseados antes da checagem de site.
- Excecao `docHtmlEstatico`: somente `GET`, caminho presente em `ESTATICOS` (checado com `Object.hasOwn`), MIME `text/html`, `sec-fetch-mode: navigate` e `sec-fetch-dest: document`.
- Liberada somente para `Sec-Fetch-Site: cross-site` com essas condicoes. Demais valores de site seguem como antes.
- Inalterados: Host loopback exato (continua primeiro), Origin/CSRF/Content-Type/body limit em POST, bind 127.0.0.1, receptor webhook, CSP e cabecalhos.

## Teste de regressao
`test/saipos-hml.test.js`, teste "cross-site: so navegacao GET de documento HTML estatico abre...", HTTP real com fixture de chave falsa (`FAKE-*`):
- GET `/` cross-site navigate/document -> 200 text/html.
- GET `/saipos.html` cross-site navigate/document -> 200 text/html.
- GET `/api/hml/config` cross-site navigate/document -> 403.
- GET `/` cross-site cors/empty -> 403.
- GET `/saipos.html` cross-site navigate/iframe -> 403.
- GET `/estilo.css` e `/saipos.js` cross-site navigate/document (ou script) -> 403.
- GET `/` com Host `evil.com` -> 403.
- POST `/api/hml/pedido` cross-site navigate/document -> 403 `origem_invalida`, zero chamadas de pedido.

## Execucao
NAO executado aqui: o executor nao roda rede/Bash neste pedido. O Codex deve rodar a suite do laboratorio-totem (`node --test test/saipos-hml.test.js`) e registrar o resultado.

Status: alteracoes feitas e revisadas por leitura; suite pendente de execucao pelo Codex.

## Fora de escopo (nao tocado)
work/private*, .env, token-cache, configs reais, ledger, estado; ERP rtmgzsikwglsvpopbfbw; pessoal kqvoatdprjwxyadhvtdd; permissao/grant/policy, robo/agendamento/replicacao, Cloudflare, cobranca, impressao, operacao real; comprasAPI.
