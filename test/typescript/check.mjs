import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function collectDiagnostics(root = projectRoot) {
  const config = ts.readConfigFile(path.join(projectRoot, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({
    file: diagnostic.file ? path.relative(root, diagnostic.file.fileName).split(path.sep).join("/") : "<config>",
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split(root).join("<root>"),
    // Keep the source expression, not its line number: moving an error does not hide a new one.
    source: diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.text.slice(diagnostic.start, diagnostic.start + diagnostic.length).trim()
      : "",
  }));
}

export function newDiagnostics(current, baseline) {
  const remaining = new Map();
  for (const diagnostic of baseline) {
    const key = JSON.stringify(diagnostic);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return current.filter(diagnostic => {
    const key = JSON.stringify(diagnostic);
    const count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"));
  if (baseline.compilerVersion !== ts.version) throw new Error("TypeScript version changed; review the baseline with the compiler update.");
  const current = collectDiagnostics();
  const added = newDiagnostics(current, baseline.diagnostics);
  for (const diagnostic of added) console.error(`${diagnostic.file}: TS${diagnostic.code}: ${diagnostic.message}\n  ${diagnostic.source}`);
  console.log(`TypeScript baseline: ${current.length} existing diagnostics remain; ${added.length} new diagnostics (main had ${baseline.diagnostics.length}).`);
  process.exitCode = added.length ? 1 : 0;
}
