import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const pointsPath = path.join(projectDir, "public", "data", "points.json");
const summaryPath = path.join(projectDir, "public", "data", "data-summary.json");
const csvPath =
  process.argv[2] ??
  "C:\\Users\\fauna\\AppData\\Local\\Temp\\estanques_density_10km.csv";

const csvLines = fs
  .readFileSync(csvPath, "utf8")
  .replace(/^\uFEFF/, "")
  .trim()
  .split(/\r?\n/);

const densityByCode = new Map();
for (const line of csvLines.slice(1)) {
  const [rawCode, rawDensity, rawClass] = line.split(",");
  const code = rawCode.trim();
  if (!code) continue;
  if (densityByCode.has(code)) {
    throw new Error(`COD_UNICO duplicado en la exportación de ArcGIS: ${code}`);
  }
  densityByCode.set(code, {
    density: Number(rawDensity),
    densityClass: rawClass.trim(),
  });
}

const payload = JSON.parse(fs.readFileSync(pointsPath, "utf8"));
const missingCodes = [];
for (const point of payload.points) {
  const update = densityByCode.get(String(point.code).trim());
  if (!update) {
    missingCodes.push(point.code);
    continue;
  }
  point.density = update.density;
  point.densityClass = update.densityClass;
}

if (missingCodes.length > 0) {
  throw new Error(
    `No se encontraron ${missingCodes.length} códigos del geoportal en ArcGIS: ${missingCodes
      .slice(0, 10)
      .join(", ")}`,
  );
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const densities = payload.points.map((point) => point.density);
summary.ranges.density = [Math.min(...densities), Math.max(...densities)];

fs.writeFileSync(pointsPath, JSON.stringify(payload), "utf8");
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const classCounts = payload.points.reduce((counts, point) => {
  counts[point.densityClass] = (counts[point.densityClass] ?? 0) + 1;
  return counts;
}, {});

console.log(
  JSON.stringify(
    {
      updated: payload.points.length,
      densityRange: summary.ranges.density,
      classCounts,
    },
    null,
    2,
  ),
);
