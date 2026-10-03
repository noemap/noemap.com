import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Outlined masters are the source of truth. No runtime font or remote image is used.
const output = new URL("../public/brand/", import.meta.url);
const design = new URL("../design/brand/", import.meta.url);
await mkdir(output, { recursive: true });
const master = await readFile(
  new URL("noemap-logo-master.svg", design),
  "utf8",
);
const symbol = await readFile(
  new URL("noemap-symbol-master.svg", design),
  "utf8",
);
const heading = await readFile(new URL("og-heading.svg", design), "utf8");
const body = (svg) =>
  svg
    .replace(/^\s*<svg[^>]*>/, "")
    .replace(/<title[^>]*>.*?<\/title>/s, "")
    .replace(/<\/svg>\s*$/, "");
const svg = (width, height, content, title = "NOEMAP") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">${content}</svg>`;
const nested = (source, x, y, width, height, viewBox) =>
  `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox}">${body(source)}</svg>`;
const writePng = (filename, source) =>
  sharp(Buffer.from(source))
    .png()
    .toFile(fileURLToPath(new URL(filename, output)));
await writeFile(new URL("noemap-logo.svg", output), master);
await writeFile(new URL("noemap-symbol.svg", output), symbol);

const iconSvg = (size, compact = false) => {
  const margin = compact ? size * 0.105 : size * 0.13;
  const available = size - 2 * margin;
  const height = (available * 280) / 310;
  return svg(
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${size * 0.17}" fill="#f7f8fa"/>` +
      nested(
        symbol,
        margin,
        (size - height) / 2,
        available,
        height,
        "0 0 310 280",
      ),
    "NOEMAPのNシンボル",
  );
};
await writePng("noemap-icon.png", iconSvg(512));
await writePng("apple-touch-icon.png", iconSvg(180));
await writeFile(new URL("favicon.svg", output), iconSvg(64, true));

// Use real multi-resolution ICO entries containing PNG data (16, 32 and 48 px).
const sizes = [16, 32, 48];
const buffers = await Promise.all(
  sizes.map((size) =>
    sharp(Buffer.from(iconSvg(size, true)))
      .png()
      .toBuffer(),
  ),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + 16 * index;
  header[entry] = header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(buffers[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += buffers[index].length;
});
await writeFile(
  new URL("favicon.ico", output),
  Buffer.concat([header, ...buffers]),
);

const logoPreview = svg(
  1440,
  480,
  `<rect width="1440" height="480" fill="#fff"/>` +
    nested(master, 70, 100, 1300, 280, "0 0 1300 280"),
);
await writePng("noemap-logo-preview.png", logoPreview);

const connections = `<g fill="none" stroke-width="1.4">
  <path d="M777 165 Q900 75 1010 245 Q1060 410 1230 465" stroke="#a9c9ef"/>
  <path d="M842 435 Q992 329 1111 321 Q1190 309 1260 164" stroke="#83b4f1"/>
  <path d="M1020 68 Q1140 90 1111 321 Q1080 450 1060 572" stroke="#b5ceee"/>
  <path d="M1010 245 Q1115 254 1130 137 Q1160 30 1270 -20" stroke="#6b9fec"/>
  <path d="M805 495 Q971 401 1030 485 Q1160 578 1260 480" stroke="#b3d1f0"/>
  <path d="M1130 137 Q1190 135 1280 192" stroke="#94b9ef"/>
  <path d="M1111 321 Q1185 353 1270 350" stroke="#b3cdec"/>
</g><g>
  <circle cx="777" cy="165" r="8" fill="#7ea9e0"/>
  <circle cx="1020" cy="68" r="7" fill="#bdcee1"/>
  <circle cx="1010" cy="245" r="11" fill="#4a87ce"/>
  <circle cx="1130" cy="137" r="17" fill="#7fa9dc"/>
  <circle cx="1111" cy="321" r="23" fill="#4185ce"/>
  <circle cx="842" cy="435" r="17" fill="#85aedd"/>
  <circle cx="805" cy="495" r="8" fill="#becfe2"/>
  <circle cx="1060" cy="572" r="8" fill="#8aaddb"/>
  <circle cx="1230" cy="465" r="7" fill="#c3d2e4"/>
</g>`;
const og = svg(
  1200,
  630,
  `<rect width="1200" height="630" fill="#fcfcfb"/>` +
    connections +
    nested(master, 64, 205, 650, 140, "0 0 1300 280") +
    nested(heading, 64, 364, 448, 92, "0 0 448 92"),
  "NOEMAP — 人間とは何か。",
);
await writeFile(new URL("noemap-home-og-master.svg", design), og);
await writePng("noemap-home-og.png", og);

// A light presentation board is separate from the actual website assets.
const label = (text, x, y) =>
  `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="22" fill="#40515b">${text}</text>`;
const board = svg(
  1440,
  1060,
  `<rect width="1440" height="1060" fill="#fff"/>` +
    `<g fill="#fcfcfb" stroke="#e2e7ec"><rect x="30" y="30" width="490" height="410" rx="18"/><rect x="540" y="30" width="870" height="410" rx="18"/><rect x="30" y="460" width="950" height="570" rx="18"/><rect x="1000" y="460" width="410" height="570" rx="18"/></g>` +
    label("noemap-icon.png · 512 × 512", 54, 74) +
    nested(iconSvg(512), 150, 115, 250, 250, "0 0 512 512") +
    label("noemap-logo.svg · N + OEMAP", 564, 74) +
    nested(master, 580, 180, 790, 170.15, "0 0 1300 280") +
    label("noemap-home-og.png · 1200 × 630", 54, 504) +
    nested(og, 50, 530, 910, 477.75, "0 0 1200 630") +
    label("favicon · N", 1024, 504) +
    nested(iconSvg(180), 1080, 556, 250, 250, "0 0 180 180") +
    label("16px / 32px / 48px", 1050, 864) +
    nested(iconSvg(16, true), 1090, 888, 16, 16, "0 0 16 16") +
    nested(iconSvg(32, true), 1134, 880, 32, 32, "0 0 32 32") +
    nested(iconSvg(48, true), 1194, 872, 48, 48, "0 0 48 48"),
);
await sharp(Buffer.from(board))
  .png()
  .toFile(fileURLToPath(new URL("noemap-brand-assets-preview.png", design)));
console.log(
  "Built logo, symbol, icon, favicon, Apple icon, OG card and presentation board.",
);
