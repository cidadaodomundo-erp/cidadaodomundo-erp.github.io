@echo off
chcp 65001 >nul
title Servidor do salao - PIX AGUA VERDE (sem Saipos)
echo Ligando o servidor do salao com o PIX DE VERDADE da Agua Verde (CNPJ 32.620.507/0001-34), sem Saipos...
echo O dinheiro cai na conta da loja. Na tela da cozinha, so toque em "Pix recebido" depois de ver o Pix no app do banco.
echo Se o Windows perguntar sobre o Firewall, clique em "Permitir acesso" (rede privada).
echo.
node "%~dp0servidor\bin\start-salao.js" --rede --pix agua-verde
echo.
echo O servidor parou. Feche esta janela.
pause
