// Generate ME Study app icons via SVG → PNG (sharp).
// Run: node scripts/generate-icons.js
// Outputs: public/icon-192.png, public/icon-512.png

import sharp from "sharp";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outDir = join(__dirname, "..", "public");

const BG = "#0f1419";
const FG = "#ffb84a";

function svg(size) {
  // Font size ~46% of canvas, slightly tight letter-spacing.
  const fontSize = Math.round(size * 0.46);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${Math.round(size * 0.18)}" ry="${Math.round(size * 0.18)}"/>
  <text x="50%" y="50%"
        font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="800"
        fill="${FG}"
        text-anchor="middle"
        dominant-baseline="central"
        letter-spacing="-2">ME</text>
</svg>`.trim();
}

async function render(size, outPath) {
  const buf = Buffer.from(svg(size));
  await sharp(buf, { density: 600 }).png().toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

await render(192, join(outDir, "icon-192.png"));
await render(512, join(outDir, "icon-512.png"));
console.log("Done.");
