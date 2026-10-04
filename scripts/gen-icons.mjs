// Generates the 3D icon set through the factory's OpenAI bridge, then packs 256px webp.
// Usage: node scripts/gen-icons.mjs [only,names]   (PNG originals stay out of git)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import sharp from "sharp";

const GPT = "C:/Users/wowo2/Documents/GitHub/factory/src/gpt.mjs";
const PREFIX = "3D icon, soft clay-glass material, blue-tinted studio lighting, isometric three-quarter view, centered, transparent background, no text, no shadow floor. Subject: ";
const ICONS = {
  radar: "a radar dish with a sweeping beam",
  dashboard: "a round speedometer gauge with a needle",
  trenches: "a satellite radar dish on a small base, with two signal arcs",
  trending: "a flame, orange-red core with blue-tinted highlights",
  launch: "a rocket taking off at a slight angle",
  portfolio: "a safe vault with a round steel door and dial handle",
  rewards: "a thick gold coin with a star embossed, slightly tilted",
  settings: "a cog gear with eight teeth",
  pumpfun: "a green and white medicine capsule pill, slightly tilted",
  bundle: "a stack of three cardboard packages tied together",
  sniper: "a sniper scope crosshair lens, circular with cross lines",
  buy: "a shopping cart",
  volume: "three stacked ocean waves",
  wash: "a single water drop",
  autodump: "an open parachute with a small crate hanging below",
  jito: "a lightning bolt",
};
const only = process.argv[2]?.split(",");
for (const [name, subject] of Object.entries(ICONS)) {
  if (only && !only.includes(name)) continue;
  const png = `public/icons/${name}.png`;
  if (!existsSync(png)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execFileSync("node", [GPT, "image", PREFIX + subject, "--out", png, "--size", "1024x1024", "--transparent"], {
          stdio: "inherit",
          env: { ...process.env, OPENAI_IMAGE_MODEL: "gpt-image-1" },
        });
        break;
      } catch {
        console.error(`retry ${name} (${attempt})`);
      }
    }
  }
  if (existsSync(png)) {
    await sharp(png).resize(256, 256).webp({ quality: 88, alphaQuality: 90 }).toFile(`public/icons/${name}.webp`);
    console.log(`packed ${name}.webp`);
  }
}
