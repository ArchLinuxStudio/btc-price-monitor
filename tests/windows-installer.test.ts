import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Windows packages request normal administrator consent and include the pinned driver", () => {
  const manifest = read("src-tauri/windows/app.manifest");
  assert.match(manifest, /level="requireAdministrator" uiAccess="false"/);
  assert.match(manifest, /Microsoft.Windows.Common-Controls/);
  const build = read("src-tauri/build.rs");
  assert.match(build, /windows_attributes/);
  assert.match(build, /PROFILE.*Ok\("release"\)/);
  const config = JSON.parse(read("src-tauri/tauri.windows.conf.json"));
  assert.equal(config.bundle.windows.nsis.installMode, "perMachine");
  assert.equal(config.bundle.windows.nsis.installerHooks, "windows/hooks.nsh");
  assert.match(config.build.beforeBuildCommand, /pawnio:prepare/);
  assert.equal(config.bundle.resources["../native/pawnio/NOTICE.txt"], "licenses/PawnIO-NOTICE.txt");
  const dependency = JSON.parse(read("native/pawnio/dependency.json"));
  assert.equal(dependency.version, "2.2.0");
  assert.equal(dependency.url, "https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe");
  assert.match(dependency.sha256, /^[a-f0-9]{64}$/);
  const prepare = read("scripts/prepare-pawnio.ps1");
  assert.match(prepare, /Get-FileHash.*SHA256/);
  assert.match(prepare, /Get-AuthenticodeSignature/);
  assert.doesNotMatch(prepare, /Start-Process|ExecWait|&\s*\$installer/);
});

test("dependency hooks preserve install output, upgrade conditions and shared driver", () => {
  const hooks = read("src-tauri/windows/hooks.nsh");
  const install = hooks.split("!macro NSIS_HOOK_PREINSTALL")[1]!.split("!macroend")[0]!;
  assert.match(install, /VersionCompare.*2\.2\.0/);
  assert.match(install, /PawnIO_setup\.exe.*-install -silent/);
  assert.match(install, /== 3010[\s\S]*SetRebootFlag true/);
  assert.match(install, /!= 0[\s\S]*SetErrorLevel 1[\s\S]*Abort/);
  assert.match(install, /SetOutPath "\$INSTDIR"\s*$/);
  const uninstall = hooks.split("!macro NSIS_HOOK_PREUNINSTALL")[1]!;
  assert.doesNotMatch(uninstall, /PawnIO_setup\.exe|DeleteRegKey.*PawnIO/);
  const cleanup = read("native/pawnio/cleanup-tasks.ps1");
  assert.match(cleanup, /com\.cryptotop\.monitor\/autostart\/v1/);
  assert.match(cleanup, /OrdinalIgnoreCase\.Equals.*\$expected/);
  assert.match(cleanup, /Actions.Count -ne 1/);
  assert.doesNotMatch(cleanup, /DeleteFolder|Remove-Item|schtasks.*\/delete.*\*/i);
});
