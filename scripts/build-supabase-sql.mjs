import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "supabase", "generated");
const outputFile = path.join(outputDir, "apply-all.sql");

const files = [
  path.join(root, "supabase", "migrations", "0001_initial_schema.sql"),
  path.join(root, "supabase", "migrations", "0002_enable_rls.sql"),
  path.join(root, "supabase", "seed-data", "seed.sql"),
];

await fs.mkdir(outputDir, { recursive: true });

const sections = [];
for (const file of files) {
  const relative = path.relative(root, file);
  const text = await fs.readFile(file, "utf8");
  sections.push([
    "-- ============================================================",
    `-- ${relative}`,
    "-- ============================================================",
    text.trim(),
    "",
  ].join("\n"));
}

await fs.writeFile(outputFile, sections.join("\n"));
console.log(outputFile);
