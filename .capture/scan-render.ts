// Pulls a stored scan from Neon, reconstructs it, and writes PNGs (raw mean vs cleaned) to compare.
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
const api = path.join(__dirname, "..", "packages", "api");
require(require.resolve("dotenv", { paths: [api] })).config({ path: path.join(api, ".env") });
const { Pool } = require(require.resolve("pg", { paths: [api] }));
import { reconstructScan, OUTLIER_SIGMAS } from "../packages/api/src/services/scanImage";

function png(file: string, n: number, px: Array<number | null>, low: number, high: number, scale = 4) {
  const w = n * scale;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const v = px[Math.floor(y / scale) * n + Math.floor(x / scale)];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      if (v === null) { raw[o] = 0; raw[o + 1] = 60; raw[o + 2] = 90; continue; }
      const g = Math.round(255 * Math.min(1, Math.max(0, (v - low) / (high - low || 1))));
      raw[o] = raw[o + 1] = raw[o + 2] = g;
    }
  }
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

(async () => {
  const scanId = process.argv[2] ?? "scan-0004";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const started = (await pool.query(`select payload from raw_messages where topic='arl/rta/events/scan' and payload->>'scan_id'=$1 and payload->>'event'='started' limit 1`, [scanId])).rows[0]?.payload;
  const { rows } = await pool.query(`select device, (payload->>'pointing_offset_ra_rad')::float8 ra, (payload->>'pointing_offset_dec_rad')::float8 dec, (payload->>'signal_strength')::float8 signal, payload->>'fault_code' fault from raw_messages where service='rta' and topic like 'arl/rta/%/telemetry/scan' and payload->>'scan_id'=$1`, [scanId]);
  await pool.end();
  const geo = { gridSize: started?.grid_size ?? 128, fovRad: started?.fov_rad ?? 0.002 };
  const t0 = Date.now();
  const clean = reconstructScan(rows, geo);
  console.log("ms", Date.now() - t0, "target", started?.target, geo, "coverage", clean.coverage.toFixed(3), clean.cleaning, { min: clean.min, max: clean.max, low: clean.low, high: clean.high, sig: OUTLIER_SIGMAS });
  png(`.capture/${scanId}-clean.png`, geo.gridSize, clean.pixels, clean.low!, clean.high!);
  // raw: every placed sample, no cleaning, min-max scale
  const sums = new Map<number, [number, number]>();
  for (const r of rows) { if (r.ra == null || r.signal == null) continue; const x = Math.floor(geo.gridSize * (r.ra / geo.fovRad + 0.5)); const y = Math.floor(geo.gridSize * (0.5 - r.dec / geo.fovRad)); const k = y * geo.gridSize + x; const s = sums.get(k) ?? [0, 0]; s[0] += r.signal; s[1]++; sums.set(k, s); }
  const rawPx = Array.from({ length: geo.gridSize ** 2 }, (_, i) => (sums.has(i) ? sums.get(i)![0] / sums.get(i)![1] : null));
  const vals = rawPx.filter((v): v is number => v !== null);
  png(`.capture/${scanId}-raw.png`, geo.gridSize, rawPx, Math.min(...vals), Math.max(...vals));
})();
