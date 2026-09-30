import { readFile, writeFile } from "node:fs/promises";

const worker = new URL("../worker/index.js", import.meta.url);
let code = await readFile(worker, "utf8");
for (const [constant, file] of [
  ["EVENT_ADMIN_HTML", "event-admin.html"],
  ["DEAL_ADMIN_HTML", "deal-admin.html"]
]) {
  const page = await readFile(new URL(`../worker/pages/${file}`, import.meta.url), "utf8");
  const match = new RegExp(`^const ${constant} = .*;$`, "m");
  if (!match.test(code)) throw Error(`Missing ${constant}`);
  code = code.replace(match, `const ${constant} = ${JSON.stringify(page)};`);
}
await writeFile(worker, code);
