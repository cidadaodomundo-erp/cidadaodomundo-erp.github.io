@echo off
chcp 65001 >nul
title Servidor do salao - TESTE (sem Saipos)
echo Ligando o servidor do salao (modo TESTE, sem Saipos)...
echo Se o Windows perguntar sobre o Firewall, clique em "Permitir acesso" (rede privada).
echo.
node "%~dp0servidor\bin\start-salao.js" --rede
echo.
echo O servidor parou. Feche esta janela.
pause
