import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const destinationRoot = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

mkdirSync(destinationRoot, { recursive: true });
cpSync(join(sourceRoot, "game"), join(destinationRoot, "game"), { recursive: true });

const shotsDestination = join(destinationRoot, "screenshots");
mkdirSync(shotsDestination, { recursive: true });
const shotsSource = join(sourceRoot, "screenshots");
if (existsSync(shotsSource)) {
  cpSync(shotsSource, shotsDestination, { recursive: true });
}

writeFileSync(
  join(destinationRoot, "dossier.json"),
  buildDossier(destinationRoot, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
