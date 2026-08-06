import fs from "fs";
import path from "path";

const iconsSrc = fs.readFileSync("src/components/ui/icons.tsx", "utf8");
const iconNames = new Set(
  [...iconsSrc.matchAll(/export function (\w+)/g)].map((m) => m[1]),
);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [...walk("src/components"), ...walk("src/app")];
let changed = 0;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const re =
    /import\s*\{([^}]+)\}\s*from\s*["']@\/components\/ui["']/g;
  let next = src;
  let fileChanged = false;
  let match;
  const replacements = [];
  while ((match = re.exec(src))) {
    const names = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const icons = [];
    const rest = [];
    for (const name of names) {
      const base = name.split(/\s+as\s+/)[0].trim();
      if (iconNames.has(base) || base.endsWith("Icon")) icons.push(name);
      else rest.push(name);
    }
    if (!icons.length) continue;
    fileChanged = true;
    let replacement = "";
    if (rest.length) {
      replacement += `import { ${rest.join(", ")} } from "@/components/ui";\n`;
    }
    replacement += `import { ${icons.join(", ")} } from "@/components/ui/icons";`;
    replacements.push([match[0], replacement]);
  }
  for (const [from, to] of replacements) {
    next = next.replace(from, to);
  }
  if (fileChanged) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log("fixed", file);
  }
}

console.log("files changed:", changed);
