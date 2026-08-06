import fs from "fs";
import path from "path";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let n = 0;
for (const file of walk("src")) {
  const src = fs.readFileSync(file, "utf8");
  const next = src.replace(/from "@\/components\/ui\/icons";\s*;/g, 'from "@/components/ui/icons";');
  if (next !== src) {
    fs.writeFileSync(file, next);
    n += 1;
    console.log(file);
  }
}
console.log("fixed", n);
