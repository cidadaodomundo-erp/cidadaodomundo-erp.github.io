# Tela do garantido para o Jaison (20/11/2026)

- Página: `jaison/` (celular primeiro; "Adicionar à tela inicial" abre como app).
- Banco: ERP rtmgzsikwglsvpopbfbw, migração `garantido_jaison_dia_20_11`:
  - `pagar_motoboys_calc(dia)`: o cálculo de `pagar_motoboys_dia(dia)` copiado do próprio banco, sem a trava; ninguém de fora executa.
  - `pagar_motoboys_dia(dia)`: igual antes (trava `pode_ver_pessoal` + o mesmo cálculo).
  - `pode_ver_garantido()`: dono, quem vê pessoal, ou e-mail em `rmb_config` chave `emails_garantido` (começa vazia).
  - `garantido_motoboys_dia(dia)`: só garantido, taxas, refeição, a receber, escala e motivo. Sem chave Pix, sem id.
- Não grava nada. Hora no pátio vem só das tabelas do ERP (`chegada_fila`, `chegada_presenca`); a tela Pagar motoboys também usa a chegada do portal antigo, então o corte por atraso pode aparecer lá e não aqui.
