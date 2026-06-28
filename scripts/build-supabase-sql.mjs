import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "supabase", "generated");
const outputFile = path.join(outputDir, "apply-all.sql");

const migrationDir = path.join(root, "supabase", "migrations");
const migrationFiles = (await fs.readdir(migrationDir))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort()
  .map((fileName) => path.join(migrationDir, fileName));

const files = [
  ...migrationFiles,
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
