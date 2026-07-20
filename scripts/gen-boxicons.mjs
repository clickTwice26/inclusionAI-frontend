// Generates app/lib/boxicons-data.ts from the installed @boxicons/core package.
//
// The app renders icons inline (see app/components/Boxicon.tsx) so they inherit
// currentColor and work in light/dark mode. This script copies the raw 24x24
// SVG inner markup for just the icons we use into a small typed data module.
//
// To add an icon: add an entry to WANT below (key -> [pack, filename]) and run
//   node scripts/gen-boxicons.mjs
// then reference it as <Boxicon name="your-key" />.
//
// Packs: "basic" (outline), "filled" (solid), "brands" (logos). Filenames are
// bx-{name}.svg. Browse node_modules/@boxicons/core/svg/<pack>/ for the catalog.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..", "node_modules", "@boxicons", "core", "svg");
const DEST = join(HERE, "..", "app", "lib", "boxicons-data.ts");

// key (used as <Boxicon name="key" />) -> [pack, filename without .svg]
const WANT = {
  "volume-full": ["basic", "bx-volume-full"],
  "sparkles": ["basic", "bx-sparkles"],
  "microphone": ["basic", "bx-microphone"],
  "headphone": ["basic", "bx-headphone"],
  "arrow-right": ["basic", "bx-arrow-right"],
  "arrow-up": ["basic", "bx-arrow-up"],
  "shield": ["basic", "bx-shield"],
  "keyboard": ["basic", "bx-keyboard"],
  "cog": ["basic", "bx-cog"],
  "globe": ["basic", "bx-globe"],
  "image": ["basic", "bx-image-alt"],
  "refresh": ["basic", "bx-refresh-cw"],
  "captions": ["basic", "bx-captions-cc"],
  "star": ["filled", "bx-star"],
  "stop": ["filled", "bx-stop"],
  "circle": ["filled", "bx-circle"],
  "play": ["filled", "bx-play"],
};

const out = {};
for (const [key, [pack, file]] of Object.entries(WANT)) {
  const raw = readFileSync(join(PKG, pack, `${file}.svg`), "utf8").trim();
  const inner = raw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  if (!inner.includes("<")) throw new Error(`no inner markup for ${key} (${file})`);
  out[key] = inner;
}

const banner =
  "// AUTO-GENERATED from @boxicons/core. Do not edit by hand.\n" +
  "// Regenerate: node scripts/gen-boxicons.mjs (see that file to add icons).\n" +
  "// Each entry is the inner SVG markup of a 24x24 boxicon; paths carry no fill\n" +
  '// so <Boxicon> applies fill="currentColor" and the icon inherits text color.\n\n';

const body =
  "export const BOXICON_MARKUP: Record<string, string> = {\n" +
  Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n") +
  "\n};\n\nexport type BoxiconName = keyof typeof BOXICON_MARKUP;\n";

writeFileSync(DEST, banner + body, "utf8");
console.log(`wrote ${DEST} with ${Object.keys(out).length} icons`);
