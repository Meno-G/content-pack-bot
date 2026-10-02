@echo off
chcp 65001 >nul
rem ================================================================
rem  Content Pack Bot — n8n + ngrok გაშვება
rem  ორჯერ დააწკაპე ამ ფაილზე. ფანჯრები ღია დატოვე, სანამ ბოტი გჭირდება.
rem ================================================================

rem ჩაწერე შენი ngrok-ის სტატიკური დომენი (ngrok dashboard -> Domains)
set "PUBLIC_URL=https://YOUR-DOMAIN.ngrok-free.app"

rem 1) ngrok ტუნელი (ცალკე ფანჯარაში)
start "ngrok" ngrok http 5678 --url=%PUBLIC_URL%

rem 2) n8n — Telegram-ის webhook-ები ngrok-ის მისამართზე, რედაქტორი localhost-ზე
set "N8N_WEBHOOK_URL=%PUBLIC_URL%/"
set "WEBHOOK_URL=%PUBLIC_URL%/"
set "N8N_EDITOR_BASE_URL=http://localhost:5678/"
set "N8N_PROXY_HOPS=1"

echo n8n ირთვება... რედაქტორი: http://localhost:5678
n8n start
