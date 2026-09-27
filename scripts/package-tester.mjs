import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...options });
run("npm", ["run", "build"]);
run("npx", ["tsc", "-p", "tsconfig.server.json"]);
const folder = resolve("release/Party Trivia");
mkdirSync(folder, { recursive: true });
for (const name of [
  "dist",
  "build",
  "media",
  "questions.json",
  "package.json",
  "package-lock.json",
  "TESTING.md",
]) {
  if (!existsSync(name)) throw new Error(`Missing ${name}`);
  cpSync(name, `${folder}/${name}`, { recursive: true });
}
for (const name of [
  "launcher.mjs",
  "Start Trivia.command",
  "Start Trivia.bat",
  "READ ME FIRST.txt",
])
  cpSync(`distribution/${name}`, `${folder}/${name}`);
run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--offline"], {
  cwd: folder,
});
// ZIP preserves the Mac launcher's executable bit. No secrets or game state are copied.
run("python3", [
  "-c",
  `import os,zipfile\nroot='release'\nwith zipfile.ZipFile('release/Party-Trivia-Tester.zip','w',zipfile.ZIP_DEFLATED) as z:\n for base,dirs,files in os.walk(root+'/Party Trivia'):\n  dirs[:]=[d for d in dirs if d not in ('data','.runtime')]\n  for f in files:\n   p=os.path.join(base,f)\n   z.write(p,os.path.relpath(p,root))`,
]);
console.log("Ready to share: release/Party-Trivia-Tester.zip");
