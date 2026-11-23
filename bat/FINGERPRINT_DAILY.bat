@echo off
REM Behavior fingerprint daily wrapper - NOT scheduled yet (owner decision pending).
REM To enable: schtasks /Create /TN DafeiyuFingerprint /TR "D:\wokebuddy\tools-1122\FINGERPRINT_DAILY.bat" /SC DAILY /ST 23:50 /F
cd /d D:\wokebuddy\tools-1122
node fingerprint.mjs >> fingerprint_daily.log 2>&1
echo %DATE% %TIME% fingerprint done >> fingerprint_daily.log
