/**
 * Tiny, deterministic, locally generated ocean wash. It adds no downloadable
 * audio asset and is generated once, only when cinematic graphics are enabled
 * and the camera actually visits the sea. 4 s of 11.025 kHz mono PCM = 44 KB.
 * Existing SoundManager applies ambience/master volumes and zoom crossfades.
 */
let cached: string | null = null;

export function oceanAmbienceDataUrl(): string {
  if (cached !== null) return cached;
  const sampleRate = 11025;
  const count = sampleRate * 4;
  const pcm = new Float32Array(count);
  let seed = 0x2f1a9c13;
  let smoothFast = 0;
  let smoothSlow = 0;
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2147483648 - 1;
    smoothFast += (white - smoothFast) * 0.075;
    smoothSlow += (white - smoothSlow) * 0.006;
    const t = i / sampleRate;
    const tide = 0.62 + 0.38 * Math.sin(t * Math.PI * 0.5);
    pcm[i] = Math.max(-1, Math.min(1,
      ((smoothFast - smoothSlow) * 1.6 + smoothSlow * 0.4) * tide));
  }
  // Smooth circular seam: the final quarter-second blends into the start.
  const seam = Math.floor(sampleRate * 0.3);
  for (let i = 0; i < seam; i++) {
    const index = count - seam + i;
    const blend = (i + 1) / seam;
    pcm[index] = pcm[index] * (1 - blend) + pcm[i] * blend;
  }
  const wav = new Uint8Array(44 + count);
  const view = new DataView(wav.buffer);
  const writeText = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[at + i] = text.charCodeAt(i);
  };
  writeText(0, "RIFF");
  view.setUint32(4, wav.length - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, "data");
  view.setUint32(40, count, true);
  for (let i = 0; i < count; i++) {
    wav[44 + i] = Math.round(128 + pcm[i] * 96);
  }
  let binary = "";
  for (let i = 0; i < wav.length; i += 8192) {
    binary += String.fromCharCode(...wav.subarray(i, i + 8192));
  }
  cached = "data:audio/wav;base64," + btoa(binary);
  return cached;
}
