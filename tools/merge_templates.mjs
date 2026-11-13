// Merge new entries (from build_cover_templates.py) into js/data/cover-templates.js.
// Usage: node tools/merge_templates.mjs new_entries.json
import { readFileSync, writeFileSync } from "node:fs";
import { COVER_TEMPLATES } from "../js/data/cover-templates.js";

const path = new URL("../js/data/cover-templates.js", import.meta.url);
const fresh = JSON.parse(readFileSync(process.argv[2], "utf8"));
const have = new Set(COVER_TEMPLATES.map((t) => t.id));
const names = new Set(COVER_TEMPLATES.map((t) => t.name));
const add = fresh.filter((t) => {
  if (have.has(t.id) || names.has(t.name)) { console.log("skip duplicate", t.id); return false; }
  have.add(t.id); names.add(t.name); return true;
});
const header = readFileSync(path, "utf8").split("export const")[0];
writeFileSync(path, `${header}export const COVER_TEMPLATES = ${JSON.stringify([...COVER_TEMPLATES, ...add], null, 2)};\n`);
console.log(`now ${COVER_TEMPLATES.length + add.length} templates (+${add.length})`);
