#!/usr/bin/env node
/**
 * Real GLSL ES 3.00 stage compilation AND cross-stage linking for the same
 * unit shaders loaded by UnitPass. Validates every supported quality profile
 * including Ultra and reduced-motion. We deliberately don't rely on tsc or
 * Vite, neither of which compiles WebGL shaders.
 *
 * Requires glslangValidator (CI installs glslang-tools).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const vertex = readFileSync(
  new URL("../src/client/render/gl/shaders/unit/unit.vert.glsl", import.meta.url),
  "utf8",
);
const fragment = readFileSync(
  new URL("../src/client/render/gl/shaders/unit/unit.frag.glsl", import.meta.url),
  "utf8",
);

// Numeric compile-time defines follow UnitPass.ts. The precise palette size
// and effect-row offsets don't change shader syntax; the identifiers do.
const vertexDefines = {
  ATLAS_COLS: 12,
  HYDROGEN_BOMB_COL: 4,
};
const fragmentDefines = {
  PALETTE_SIZE: 4096,
  ATLAS_COLS: 12,
  WARSHIP_COL: 2,
  WARSHIP_EFFECT_ROW_BASE: 40,
  TRAIN_FIRST_COL: 9,
  TRAIN_EFFECT_ROW_BASE: 80,
};

const profiles = [
  { name: "classic", flags: [] },
  { name: "cinematic-medium", flags: ["FRONTIER_CINEMATIC", "FRONTIER_CINEMATIC_MEDIUM"] },
  { name: "cinematic-high", flags: ["FRONTIER_CINEMATIC"] },
  { name: "cinematic-ultra", flags: ["FRONTIER_CINEMATIC", "FRONTIER_CINEMATIC_ULTRA"] },
  { name: "cinematic-ultra-reduced-motion", flags: ["FRONTIER_CINEMATIC", "FRONTIER_CINEMATIC_ULTRA", "FRONTIER_REDUCED_MOTION"] },
];
function injectDefines(source, flags, values) {
  const definitions = [
    ...flags.map((key) => `#define ${key} 1`),
    ...Object.entries(values).map(([key, value]) => `#define ${key} ${value}`),
  ].join("\n");
  if (!source.startsWith("#version 300 es\n"))
    throw new Error("The unit shader is no longer GLSL ES 3.00.");
  return source.replace("#version 300 es\n", `#version 300 es\n${definitions}\n`);
}

const dir = mkdtempSync(join(tmpdir(), "myfront-naval-glsl-"));
try {
  for (const profile of profiles) {
    const v = join(dir, `${profile.name}.vert`);
    const f = join(dir, `${profile.name}.frag`);
    writeFileSync(v, injectDefines(vertex, profile.flags, vertexDefines));
    writeFileSync(f, injectDefines(fragment, profile.flags, fragmentDefines));
    const result = spawnSync("glslangValidator", ["-l", v, f], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(`\n${profile.name} shader compilation/link failed:\n`);
      process.stderr.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
      throw result.error || new Error(`glslangValidator exited with ${result.status}`);
    }
    process.stdout.write(`PASS: ${profile.name} vertex + fragment compile and link\n`);
  }

  // These defensive-map shader stages also run in the Geopolitics client.
  // Vite bundles shader strings but does not compile or link WebGL programs.
  // Compile the actual selected-coverage and interception-ring pairs in CI.
  for (const effect of ["range-circle", "iron-dome"]) {
    const vertexPath = new URL(
      `../src/client/render/gl/shaders/${effect}/${effect}.vert.glsl`,
      import.meta.url,
    );
    const fragmentPath = new URL(
      `../src/client/render/gl/shaders/${effect}/${effect}.frag.glsl`,
      import.meta.url,
    );
    const v = join(dir, `${effect}.vert`);
    const f = join(dir, `${effect}.frag`);
    writeFileSync(v, readFileSync(vertexPath, "utf8"));
    writeFileSync(f, readFileSync(fragmentPath, "utf8"));
    const result = spawnSync("glslangValidator", ["-l", v, f], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(`\n${effect} shader compilation/link failed:\n`);
      process.stderr.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
      throw result.error || new Error(
        `glslangValidator exited with ${result.status}`,
      );
    }
    process.stdout.write(`PASS: ${effect} defense shader stages compile and link\n`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
