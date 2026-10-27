import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workerPath = "public/share-sw.js";
const versionPattern = /const CACHE_NAME = "nodeshell-share-[^"]+";/;
const worker = readFileSync(workerPath, "utf8");
if (!versionPattern.test(worker)) throw new Error("Share service worker cache name is missing");

const files = ["app/globals.css", "app/layout.tsx", "lib/client/api.ts", workerPath];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile()) files.push(path);
  }
}
collect("app/share");
collect("public/share");

const hash = createHash("sha256");
for (const file of [...new Set(files)].sort()) {
  hash.update(file);
  const contents = readFileSync(file);
  hash.update(file === workerPath
    ? Buffer.from(contents.toString().replace(versionPattern, 'const CACHE_NAME = "nodeshell-share-VERSION";'))
    : contents);
}
const version = hash.digest("hex").slice(0, 12);
const stamped = worker.replace(versionPattern, `const CACHE_NAME = "nodeshell-share-${version}";`);
if (stamped !== worker) writeFileSync(workerPath, stamped);
console.log(`Share PWA version: ${version}`);
