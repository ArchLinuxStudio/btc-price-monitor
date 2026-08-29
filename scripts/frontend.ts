import { once } from "node:events";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(repositoryDirectory, "src");
const outputDirectory = resolve(repositoryDirectory, "dist");
const staticFiles = new Set(["index.html", "styles.css"]);
const watchMode = process.argv.includes("--watch");

if (dirname(outputDirectory) !== repositoryDirectory || basename(outputDirectory) !== "dist") {
  throw new Error(`Refusing to clean unexpected output directory: ${outputDirectory}`);
}

async function copyStaticFile(fileName: string): Promise<void> {
  if (!staticFiles.has(fileName)) {
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  await copyFile(resolve(sourceDirectory, fileName), resolve(outputDirectory, fileName));
}

async function prepareOutput(): Promise<void> {
  if (!watchMode) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...staticFiles].map(copyStaticFile));
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
  const staticWatcher = watch(sourceDirectory, (_eventType, fileName) => {
    if (typeof fileName !== "string" || !staticFiles.has(fileName)) {
      return;
    }

    void copyStaticFile(fileName).catch((error: unknown) => {
      console.error(`Failed to copy ${fileName}:`, error);
    });
  });

  const stop = (signal: NodeJS.Signals): void => {
    staticWatcher.close();
    compiler.kill(signal);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  compiler.once("exit", (code, signal) => {
    staticWatcher.close();
    if (signal === null) {
      process.exitCode = code ?? 1;
    }
  });
} else {
  const [code] = (await once(compiler, "exit")) as [number | null, NodeJS.Signals | null];
  process.exitCode = code ?? 1;
}
