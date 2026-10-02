@echo off
chcp 65001 >nul
echo ===================================================================
echo   台灣交通路況與機車路權改革 AI 評估系統 (Taiwan Traffic AI Lab)
echo ===================================================================
echo.
echo 正在啟動 FastAPI 後端伺服器 (http://127.0.0.1:8000)...
echo.
start http://127.0.0.1:8000
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
