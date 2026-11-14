# Bundled PawnIO prerequisite

The Windows NSIS installer embeds the unmodified official **PawnIO 2.2.0**
setup program. `scripts/prepare-pawnio.ps1` downloads it only at build time,
checks the pinned SHA-256 and Authenticode publisher, and prepares an ignored
resource directory. No setup program is executed by the build or tests.

The hash is published in the official release asset metadata and the
[Microsoft WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/n/namazso/PawnIO/2.2.0/namazso.PawnIO.installer.yaml).
That manifest specifies machine scope, `-install -silent`, upgrade-in-place
and successful reboot-required exit code `3010`. The
[official release notes](https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0)
also document Win32 exit codes and reboot-required reporting. No unrestricted
edition, driver ACL change, security setting change or unsigned driver is used.

The original setup's embedded notice explicitly permits unmodified
redistribution; it is reproduced in `NOTICE.txt`. The exe is bundled as a
separate installer, not modified or represented as Crypto Top's own driver.

The installer requests elevation and uses a Program Files installation by
default. Its hook checks the 64-bit PawnIO registration and installs only when
the installed version is absent or older. Exit codes other than 0/3010 stop
installation with a recoverable error; 3010 sets the outer installer's reboot
flag. The shared driver is deliberately retained on application uninstall.

Migration from the old per-user preview never executes an HKCU-provided
uninstall command and never removes user data. It retargets only current-user
Crypto Top shortcuts whose old target matches that preview's registered
executable, so they cannot hide the new all-users shortcuts. Old binaries and
their uninstall registration remain available for manual removal. When UAC
uses a different administrator account, that account's HKCU/current-user
folders differ; the original user's profile is not enumerated or modified.
Use the newly installed Program Files application in that case.
