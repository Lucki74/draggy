; Runs before Tauri copies files. Closes a running app and removes the Electron build, leaving %APPDATA%\Draggy alone.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM Draggy.exe /T'
  IfFileExists "$LOCALAPPDATA\Programs\Draggy\Uninstall Draggy.exe" 0 +2
  ExecWait '"$LOCALAPPDATA\Programs\Draggy\Uninstall Draggy.exe" /S _?=$LOCALAPPDATA\Programs\Draggy'
!macroend
