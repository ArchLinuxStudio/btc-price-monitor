# Temperature helper third-party notices

Crypto Top's helper code is covered by the repository's GPL-3.0-only license.
The following unmodified components are bundled as separate assemblies. NuGet
package metadata, copyright notices and package-supplied license files accompany
them in `licenses/`. Build-only .NET reference assemblies are not redistributed.
`packages.lock.json` records the complete dependency graph and package hashes.

- **LibreHardwareMonitorLib 0.9.6**, MPL-2.0; Copyright LibreHardwareMonitor
  contributors, including Michael Möller and Open Hardware Monitor contributors.
  Source: <https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6>
  (commit `3d331e3370efb858411f19511373eff65a218701`). The original library's
  `THIRD-PARTY-NOTICES.txt` is included alongside its MPL license.
- **PawnIO.Modules 0.1.6**, LGPL-2.1, embedded in LibreHardwareMonitorLib.
  Source: <https://github.com/namazso/PawnIO.Modules/tree/0.1.6>.
  The original notices and LGPL text are included. The PawnIO kernel driver is
  **not** bundled or installed by this helper.
- **RAMSPDToolkit-NDD 1.4.2**, MPL-2.0; Copyright Florian K.
  Source: <https://github.com/Blacktempel/RAMSPDToolkit/tree/3b47b960e0830fef344624ad5e389675d5f0a1ce>.
- **DiskInfoToolkit 1.1.2**, MPL-2.0; Copyright Florian K.
  Source: <https://github.com/Blacktempel/DiskInfoToolkit/tree/25319eae5781e75bcf141e844ceab2afe94d40ea>.
- **BlackSharp.Core 1.0.7**, MPL-2.0; Copyright Florian K.
  Source: <https://github.com/Blacktempel/BlackSharp/tree/c70b735c6cec123ee8a046ac4a0bc6c606f52cf0>.
- **HidSharp 2.6.4**, Apache-2.0; Copyright 2010-2025 James Bellinger.
  Source and project: <https://software.seekye.com/hidsharp>.
- **Microsoft System.* assemblies**, MIT; Copyright .NET Foundation and
  Contributors. Exact versions and source repository commits are in the included
  NuGet metadata. Source: <https://github.com/dotnet/runtime>.

No hardware monitoring dependency has been modified. The assemblies remain
separate and replaceable; no strong-name enforcement or application integrity
check prevents replacing them for debugging modifications under their licenses.
