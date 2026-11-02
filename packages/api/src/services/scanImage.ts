/**
 * RTA scan image reconstruction (RTA spec, section 3).
 *
 * A scan divides the target's field of view θ into an N × N grid; every sample
 * on a dish's scan stream measures one pixel. The pixel of a sample is
 *
 *     x = ⌊N (Δα/θ + ½)⌋,   y = ⌊N (½ − Δδ/θ)⌋
 *
 * (column 0 at the most negative RA offset, row 0 at the top = north), and a
 * pixel's brightness is the mean signal_strength of the samples that land on it.
 *
 * The spec warns the data is noisy and that faulty dishes produce outliers "far
 * brighter than the rest of the image". Taking the mean of the raw samples lets
 * one bad dish punch bright speckles across the whole picture, so the samples
 * are cleaned first:
 *
 *  1. samples with a null offset or signal (dish slewing, scan paused) carry no
 *     pixel and are skipped, as the spec says;
 *  2. samples from a dish reporting a fault code are dropped;
 *  3. each pixel is sampled by ~k different dishes, so a sample that disagrees
 *     with the other samples of its own pixel by more than OUTLIER_SIGMAS times
 *     the array-wide sample noise is an outlier. Comparing against the pixel's
 *     own median (not the image's) keeps genuinely bright sources;
 *  4. a dish whose samples are mostly outliers is excluded altogether.
 *
 * What remains is averaged per pixel. Pixels with no samples are holes (null),
 * not zero - a dish dropping out of a scan must not draw a dark patch.
 */

export interface ScanSample {
  device: string | null;
  ra: number | null;
  dec: number | null;
  signal: number | null;
  fault?: string | null;
}

export interface ScanGeometry {
  gridSize: number;
  fovRad: number;
}

export interface ScanCleaning {
  /** Samples offered. */
  total: number;
  /** Null offset or signal: no pixel (spec 3.2). */
  empty: number;
  /** Offsets outside the field of view. */
  outOfField: number;
  /** From a dish reporting a fault code. */
  faulty: number;
  /** Disagreed with the rest of their pixel. */
  outliers: number;
  /** From a dish excluded for being mostly outliers. */
  excluded: number;
  /** Samples that made it into a pixel. */
  used: number;
  excludedDishes: string[];
}

export interface ReconstructedImage extends ScanGeometry {
  /** Row-major, N × N; null marks a hole. */
  pixels: Array<number | null>;
  /** Fraction of pixels with at least one sample. */
  coverage: number;
  min: number | null;
  max: number | null;
  /** 2nd and 98th percentile of the pixel values: a display range a lone hot pixel cannot flatten. */
  low: number | null;
  high: number | null;
  cleaning: ScanCleaning;
}

/** A sample further than this many noise-sigmas from its pixel's median is rejected. */
export const OUTLIER_SIGMAS = 5;
/** A dish with more than this share of its samples rejected is dropped entirely. */
export const DISH_OUTLIER_SHARE = 0.5;

/** Spec 3.1. Null when the offset falls outside the field. */
export function pixelOf(ra: number, dec: number, { gridSize: n, fovRad: fov }: ScanGeometry): [number, number] | null {
  const x = Math.floor(n * (ra / fov + 0.5));
  const y = Math.floor(n * (0.5 - dec / fov));
  if (x < 0 || x >= n || y < 0 || y >= n) return null;
  return [x, y];
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

const ascending = (a: number, b: number) => a - b;
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

interface Placed {
  device: string;
  signal: number;
  pixel: number;
}

export function reconstructScan(samples: ScanSample[], geometry: ScanGeometry): ReconstructedImage {
  const n = geometry.gridSize;
  const cleaning: ScanCleaning = {
    total: samples.length,
    empty: 0,
    outOfField: 0,
    faulty: 0,
    outliers: 0,
    excluded: 0,
    used: 0,
    excludedDishes: []
  };

  // 1-2: place every usable sample on its pixel.
  const placed: Placed[] = [];
  for (const sample of samples) {
    if (!finite(sample.ra) || !finite(sample.dec) || !finite(sample.signal)) {
      cleaning.empty += 1;
      continue;
    }
    if (sample.fault && sample.fault !== "none") {
      cleaning.faulty += 1;
      continue;
    }
    const xy = pixelOf(sample.ra, sample.dec, geometry);
    if (!xy) {
      cleaning.outOfField += 1;
      continue;
    }
    placed.push({ device: sample.device ?? "?", signal: sample.signal, pixel: xy[1] * n + xy[0] });
  }

  const byPixel = new Map<number, Placed[]>();
  for (const sample of placed) {
    const list = byPixel.get(sample.pixel);
    if (list) list.push(sample);
    else byPixel.set(sample.pixel, [sample]);
  }

  // 3: the array-wide noise level, from how far samples sit from their own
  // pixel's median (MAD, scaled to a Gaussian sigma). Pixels with a single
  // sample say nothing about noise and are left out of the estimate.
  const pixelMedian = new Map<number, number>();
  const deviations: number[] = [];
  for (const [pixel, list] of byPixel) {
    const values = list.map((s) => s.signal).sort(ascending);
    const m = median(values);
    pixelMedian.set(pixel, m);
    if (values.length >= 2) for (const v of values) deviations.push(Math.abs(v - m));
  }
  const sigma = deviations.length > 0 ? 1.4826 * median(deviations.sort(ascending)) : 0;
  // With fewer than three samples a "median" is just one of the two, so only
  // pixels with a real majority can outvote a sample.
  const isOutlier = (s: Placed) => {
    const list = byPixel.get(s.pixel)!;
    return sigma > 0 && list.length >= 3 && Math.abs(s.signal - pixelMedian.get(s.pixel)!) > OUTLIER_SIGMAS * sigma;
  };

  // 4: dishes that are mostly wrong are not trusted for any of their samples.
  const perDish = new Map<string, { total: number; outliers: number }>();
  for (const sample of placed) {
    const tally = perDish.get(sample.device) ?? { total: 0, outliers: 0 };
    tally.total += 1;
    if (isOutlier(sample)) tally.outliers += 1;
    perDish.set(sample.device, tally);
  }
  const excluded = new Set(
    [...perDish.entries()]
      .filter(([, tally]) => tally.total >= 10 && tally.outliers / tally.total > DISH_OUTLIER_SHARE)
      .map(([device]) => device)
  );
  cleaning.excludedDishes = [...excluded].sort();

  const sums = new Float64Array(n * n);
  const counts = new Uint16Array(n * n);
  for (const sample of placed) {
    if (excluded.has(sample.device)) {
      cleaning.excluded += 1;
    } else if (isOutlier(sample)) {
      cleaning.outliers += 1;
    } else {
      sums[sample.pixel] += sample.signal;
      counts[sample.pixel] += 1;
      cleaning.used += 1;
    }
  }

  const pixels: Array<number | null> = new Array(n * n);
  const values: number[] = [];
  for (let i = 0; i < n * n; i += 1) {
    if (counts[i] === 0) {
      pixels[i] = null;
    } else {
      const value = sums[i] / counts[i];
      pixels[i] = value;
      values.push(value);
    }
  }
  values.sort(ascending);

  return {
    ...geometry,
    pixels,
    coverage: values.length / (n * n),
    min: values.length > 0 ? values[0] : null,
    max: values.length > 0 ? values[values.length - 1] : null,
    low: values.length > 0 ? percentile(values, 0.02) : null,
    high: values.length > 0 ? percentile(values, 0.98) : null,
    cleaning
  };
}
