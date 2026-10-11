import mark from "../../assets/dragon.png";

/** The dragon's outline as points in a unit square, laid out the way the Logo mask lays the image
 * out (contained and centred), so embers born on them sit on the drawn edge. Sampled once from the
 * alpha channel and shared. */

const GRID = 96;
const SOLID = 128;

let cached: Promise<{ x: number; y: number }[]> | null = null;

export function edgePoints(alpha: Uint8ClampedArray, size: number): { x: number; y: number }[] {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && alpha[(y * size + x) * 4 + 3] > SOLID;
  const points: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) {
        points.push({ x: (x + 0.5) / size, y: (y + 0.5) / size });
      }
    }
  }
  return points;
}

export function markOutline(): Promise<{ x: number; y: number }[]> {
  cached ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = GRID;
      canvas.height = GRID;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || !image.width || !image.height) return resolve([]);
      const scale = Math.min(GRID / image.width, GRID / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (GRID - width) / 2, (GRID - height) / 2, width, height);
      resolve(edgePoints(context.getImageData(0, 0, GRID, GRID).data, GRID));
    };
    image.onerror = () => resolve([]);
    image.src = mark;
  });
  return cached;
}
