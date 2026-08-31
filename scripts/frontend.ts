import { once } from "node:events";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(repositoryDirectory, "src");
const outputDirectory = resolve(repositoryDirectory, "dist");
const appVersionToken = "{{APP_VERSION}}";
const licensePath = resolve(repositoryDirectory, "LICENSE");
const tauriConfigPath = resolve(repositoryDirectory, "src-tauri", "tauri.conf.json");
const staticFiles = new Map<string, string>([
  ["index.html", resolve(sourceDirectory, "index.html")],
  ["styles.css", resolve(sourceDirectory, "styles.css")],
  ["about.html", resolve(sourceDirectory, "about.html")],
  ["about.css", resolve(sourceDirectory, "about.css")],
  ["app-icon.svg", resolve(repositoryDirectory, "assets", "app-icon.svg")],
  ["LICENSE.txt", licensePath],
]);
const watchMode = process.argv.includes("--watch");

if (dirname(outputDirectory) !== repositoryDirectory || basename(outputDirectory) !== "dist") {
  throw new Error(`Refusing to clean unexpected output directory: ${outputDirectory}`);
}

async function copyStaticFile(fileName: string): Promise<void> {
  const sourcePath = staticFiles.get(fileName);
  if (sourcePath === undefined) {
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, fileName);

  if (fileName === "about.html") {
    const [tauriConfigSource, template] = await Promise.all([
      readFile(tauriConfigPath, "utf8"),
      readFile(sourcePath, "utf8"),
    ]);
    const tauriConfig = JSON.parse(tauriConfigSource) as { version?: unknown };
    if (typeof tauriConfig.version !== "string" || tauriConfig.version.length === 0) {
      throw new Error("Tauri application version is unavailable");
    }

    if (!template.includes(appVersionToken)) {
      throw new Error(`Missing ${appVersionToken} in about.html`);
    }

    const renderedAbout = template.split(appVersionToken).join(tauriConfig.version);
    await writeFile(outputPath, renderedAbout, "utf8");
    return;
  }

  await copyFile(sourcePath, outputPath);
}

async function prepareOutput(): Promise<void> {
  if (!watchMode) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...staticFiles.keys()].map(copyStaticFile));
}

await prepareOutput();

const require = createRequire(import.meta.url);
const compilerEntry = require.resolve("typescript/bin/tsc");
const compilerArguments = [
  compilerEntry,
  "--project",
  resolve(repositoryDirectory, "tsconfig.build.json"),
];

if (watchMode) {
  compilerArguments.push("--watch", "--preserveWatchOutput");
}

const compiler = spawn(process.execPath, compilerArguments, {
  cwd: repositoryDirectory,
  stdio: "inherit",
});

if (watchMode) {
  const watchedDirectories = new Set([
    ...[...staticFiles.values()].map(dirname),
    dirname(tauriConfigPath),
  ]);
  const staticWatchers = [...watchedDirectories].map((directory) => {
    return watch(directory, (_eventType, fileName) => {
      if (typeof fileName !== "string") {
        return;
      }

      const changedPath = resolve(directory, fileName);
      const affectedOutputs = [...staticFiles.entries()]
        .filter(([, sourcePath]) => sourcePath === changedPath)
        .map(([outputName]) => outputName);
      if (changedPath === tauriConfigPath) {
        affectedOutputs.push("about.html");
      }

      for (const outputName of new Set(affectedOutputs)) {
        void copyStaticFile(outputName).catch((error: unknown) => {
          console.error(`Failed to update ${outputName}:`, error);
        });
      }
    });
  });

  const stop = (signal: NodeJS.Signals): void => {
    for (const staticWatcher of staticWatchers) {
      staticWatcher.close();
    }
    compiler.kill(signal);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  compiler.once("exit", (code, signal) => {
    for (const staticWatcher of staticWatchers) {
      staticWatcher.close();
    }
    if (signal === null) {
      process.exitCode = code ?? 1;
    }
  });
} else {
  const [code] = (await once(compiler, "exit")) as [number | null, NodeJS.Signals | null];
  process.exitCode = code ?? 1;
}
