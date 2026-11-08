/**
 * Seamless, deterministic detail normals for the opt-in cinematic ocean.
 * Generated once per match as 128x128 RGBA8 (~64 KiB, ~85 KiB with mipmaps).
 * This is not a map-sized asset, water simulation or particle field.
 */
export const OCEAN_DETAIL_SIZE = 128;

function hash(x: number, y: number, period: number): number {
  const xx = ((x % period) + period) % period;
  const yy = ((y % period) + period) % period;
  let h = Math.imul(xx + 17, 374761393) ^ Math.imul(yy + 53, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, period: number): number {
  const fx = x * period / OCEAN_DETAIL_SIZE;
  const fy = y * period / OCEAN_DETAIL_SIZE;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, period);
  const b = hash(ix + 1, iy, period);
  const c = hash(ix, iy + 1, period);
  const d = hash(ix + 1, iy + 1, period);
  return (a * (1 - sx) + b * sx) * (1 - sy) +
    (c * (1 - sx) + d * sx) * sy;
}

export function buildOceanDetailTexture(): Uint8Array {
  const size = OCEAN_DETAIL_SIZE;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      heights[y * size + x] = noise(x, y, 8) * 0.52 +
        noise(x, y, 16) * 0.29 + noise(x, y, 32) * 0.19;
    }
  }
  const rgba = new Uint8Array(size * size * 4);
  const height = (x: number, y: number) =>
    heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * 3.2;
      const dy = (height(x, y + 1) - height(x, y - 1)) * 3.2;
      const h = height(x, y);
      const index = (y * size + x) * 4;
      rgba[index] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - dx * 0.5)));
      rgba[index + 1] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - dy * 0.5)));
      rgba[index + 2] = Math.round(255 * Math.max(0, Math.min(1, (h - 0.42) / 0.29)));
      rgba[index + 3] = 255;
    }
  }
  return rgba;
}
