# Visual CDM — app de teste (12/11)

Escopo: **somente a UI do laboratório de teste** (`public/cardapio-hml.{html,css,js}`). Nenhuma mudança em regras comerciais, API, CSRF, CSP, Host/Origin, guardas HML, ledger, TV, cozinha ou Saipos.

## Fontes e procedência dos assets (`public/marca`)
- `Cubano-Regular.otf`: tipografia de títulos/chamadas da marca (cópia local já existente do coordenador).
- `Barlow-Regular.ttf`, `Barlow-SemiBold.ttf` + `OFL-Barlow.txt`: corpo e textos funcionais (licença SIL OFL, texto incluído).
- `logo-cdm.png`: logo ORIGINAL CDM (fundo #111); usado com `object-fit: contain`, sem redesenho nem deformação.
- `arte-colagem.png`: arte abstrata de apoio, **da prévia local**, usada só em baixa opacidade nas bordas; não é parede real.
- `burger-hero.jpg`: foto real otimizada (1600px) para o hero.
- `abertura.mp4` / `abertura-poster.jpg`: vídeo vertical 800x1280, 10 s, original copiado do Totem 1.
- Fotos de produtos: `/gama-fotos` existentes, sem comida gerada por IA. A colagem abstrata de apoio veio da prévia de marketing com criação assistida por IA; não representa uma parede real.
- Referência de fluxo: apenas a ideia de abertura → cardápio → pedido. Nenhum código, marca ou ativo de terceiros copiado.
- Cores (referências, não manual oficial): #111111, #F4EBDD, #E0A81C, branco. Sem verde corporativo, sem estilo ERP/Inter/Arial.

## Escolha tipográfica (Cubano sem Ç/ç)
O Cubano disponível não tem `Ç/ç`. Chamadas **estáticas** usam Cubano em caixa alta com acentos suportados (A FOME TEM DESTINO. / SEU PRÓXIMO DESTINO. / VER CARDÁPIO). Nomes dinâmicos (produtos, categorias), botões funcionais e qualquer texto com cedilha usam Barlow SemiBold. Nenhum nome, preço ou dado foi alterado para esconder o problema. Fallback se o arquivo não carregar: `Impact, Arial Narrow, sans-serif` (títulos) e `Segoe UI, system-ui` (corpo).

## Comportamento
- Abertura a cada carga da página; vídeo muted/autoplay/loop/playsinline com poster como fundo. Se o vídeo falhar ou `prefers-reduced-motion`, fica o poster e o CTA continua ativo. Sem timer de ociosidade: nunca limpa carrinho nem escolhas.
- Botão "Início" volta à abertura, desabilitado durante envio.
- Carrinho: barra fixa inferior + painel lateral (tela inteira no celular) com `inert`/`aria-hidden`, Esc, fundo clicável e botão "Voltar ao cardápio"; fechar não perde itens. Envio abre o painel e mantém o resultado visível. "Enviar pedido de teste" não usa o termo Pagar nem simula pagamento.
- Modal: foto + opções, rodapé "Adicionar" sempre visível, scroll só no corpo; steppers 52px; `aria-label`s originais preservados; só `textContent`.
- Categoria ativa por scroll (não reseta na atualização de 60 s). O destaque no menu rola apenas o próprio nav (nunca o documento); clique em categoria trava o scrollspy até a rolagem parar (`scrollend`/debounce, teto de 5 s).

## Limites e não publicação
Visual de **teste local**; não autorizado para publicação externa. Sem rede/CDN, sem pagamento, impressora ou TV física. Backend publica apenas rotas estáticas explícitas para os 9 arquivos de `/marca` em `src/saipos-hml.js`.
