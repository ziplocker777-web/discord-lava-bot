@echo off
rem ===================================================================
rem  Ziplocker Bot launcher
rem
rem  Double-click this file to run the bot. Leave the window open --
rem  closing it stops the bot.
rem
rem  The loop below restarts the bot if it ever exits. That is not
rem  paranoia: connections from this machine to Discord's Cloudflare
rem  front (162.159.x.x) drop often enough that a login can time out,
rem  and a bot that dies quietly at 3am stays dead until somebody
rem  notices. index.js retries the login itself; this catches whatever
rem  gets past that.
rem ===================================================================

title Ziplocker Bot
cd /d "%~dp0"

:loop
echo.
echo ============================================================
echo  starting bot -- %date% %time%
echo ============================================================
node index.js

echo.
echo  bot exited (code %errorlevel%) -- restarting in 10 seconds
echo  press Ctrl+C now if you meant to stop it
timeout /t 10 /nobreak >nul
goto loop
