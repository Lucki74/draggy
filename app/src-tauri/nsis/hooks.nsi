; Runs before Tauri copies files. Closes a running app and removes the Electron build, leaving %APPDATA%\Draggy alone.
; The Electron installer put its build in LOCALAPPDATA\Programs (per user) or Program Files (per machine).
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM Draggy.exe /T'
  IfFileExists "$LOCALAPPDATA\Programs\Draggy\Uninstall Draggy.exe" 0 +2
  ExecWait '"$LOCALAPPDATA\Programs\Draggy\Uninstall Draggy.exe" /S _?=$LOCALAPPDATA\Programs\Draggy'
  IfFileExists "$PROGRAMFILES64\Draggy\Uninstall Draggy.exe" 0 +2
  ExecWait '"$PROGRAMFILES64\Draggy\Uninstall Draggy.exe" /S _?=$PROGRAMFILES64\Draggy'
!macroend
