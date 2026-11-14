!include "WordFunc.nsh"
!insertmacro VersionCompare
!define CRYPTOTOP_HOOK_DIR "${__FILEDIR__}"

Var CryptoTopLegacyDir
Var CryptoTopLegacyBinary

!macro NSIS_HOOK_PREINSTALL
  ; Keep current-user preview data/binaries intact. Never execute HKCU commands
  ; from this elevated installer; only inspect them for shortcut migration.
  ReadRegStr $CryptoTopLegacyDir HKCU "${MANUPRODUCTKEY}" ""
  ReadRegStr $CryptoTopLegacyBinary HKCU "${UNINSTKEY}" "MainBinaryName"
  ${If} $CryptoTopLegacyBinary == ""
    StrCpy $CryptoTopLegacyBinary "${MAINBINARYNAME}.exe"
  ${EndIf}

  SetRegView 64
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO" "DisplayVersion"
  StrCpy $R1 2
  ${If} $R0 != ""
    ${VersionCompare} "$R0" "2.2.0" $R1
  ${EndIf}
  ${If} $R1 == 2
    DetailPrint "Installing bundled PawnIO temperature driver..."
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=PawnIO_setup.exe "${CRYPTOTOP_HOOK_DIR}\..\resources\pawnio\PawnIO_setup.exe"
    ClearErrors
    ExecWait '"$PLUGINSDIR\PawnIO_setup.exe" -install -silent' $R2
    ${If} ${Errors}
      StrCpy $R2 -1
    ${EndIf}
    ${If} $R2 == 3010
      SetRebootFlag true
      DetailPrint "PawnIO installed; restart Windows to finish driver setup."
    ${ElseIf} $R2 != 0
      MessageBox MB_OK|MB_ICONSTOP "PawnIO driver installation failed (code $R2). Please restart Windows and run this installer again." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${Else}
    DetailPrint "PawnIO $R0 is already installed; keeping the existing driver."
  ${EndIf}
  ; Tauri's following File instructions rely on this output directory.
  SetOutPath "$INSTDIR"
!macroend

!macro CryptoTopRetargetLegacyShortcut shortcut
  !insertmacro IsShortcutTarget "${shortcut}" "$CryptoTopLegacyDir\$CryptoTopLegacyBinary"
  Pop $0
  ${If} $0 == 1
    !insertmacro SetShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $CryptoTopLegacyDir != ""
  ${AndIf} $CryptoTopLegacyDir != $INSTDIR
    SetShellVarContext current
    !insertmacro CryptoTopRetargetLegacyShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
    !insertmacro CryptoTopRetargetLegacyShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    !if "${STARTMENUFOLDER}" != ""
      !insertmacro CryptoTopRetargetLegacyShortcut "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk"
    !endif
    SetShellVarContext all
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Preserve opt-in through updater replacement; explicit uninstall removes
  ; only our marked tasks whose sole action points to this installation.
  ${If} $UpdateMode != 1
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=cleanup-cryptotop-tasks.ps1 "${CRYPTOTOP_HOOK_DIR}\..\..\native\pawnio\cleanup-tasks.ps1"
    ClearErrors
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cleanup-cryptotop-tasks.ps1" -InstallPath "$INSTDIR"' $R2
    ${If} ${Errors}
      StrCpy $R2 -1
    ${EndIf}
    ${If} $R2 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to remove Crypto Top startup tasks (code $R2). Uninstall stopped; please retry." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  ; PawnIO is shared with other software and is intentionally not uninstalled.
!macroend
