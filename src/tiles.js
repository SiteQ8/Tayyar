// Tile addressing for static CT logs (c2sp.org/static-ct-api, "Merkle Tree").

export const TILE_WIDTH = 256;

// Index 1234067 becomes x001/x234/067: three digit groups, every group but
// the last prefixed with "x".
export function tilePath(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`invalid tile index ${n}`);
  const groups = [];
  let x = n;
  do {
    groups.unshift(x % 1000);
    x = Math.floor(x / 1000);
  } while (x > 0);
  return groups.map((g, i) => (i < groups.length - 1 ? 'x' : '') + String(g).padStart(3, '0')).join('/');
}

export function dataTileUrl(prefix, n, width = TILE_WIDTH) {
  const suffix = width === TILE_WIDTH ? '' : `.p/${width}`;
  return `${prefix}tile/data/${tilePath(n)}${suffix}`;
}

/**
 * Lists the data tiles needed to read entries [next, treeSize).
 * Full tiles are always listed. The trailing partial tile is listed only when
 * `includePartial` is set, because the spec asks tailing clients to wait for
 * the full tile when they can.
 */
export function planTiles(next, treeSize, includePartial = false) {
  const plan = [];
  if (treeSize <= next) return plan;
  const fullTiles = Math.floor(treeSize / TILE_WIDTH);
  for (let n = Math.floor(next / TILE_WIDTH); n < fullTiles; n++) {
    plan.push({ n, width: TILE_WIDTH, skip: Math.max(0, next - n * TILE_WIDTH) });
  }
  const tail = treeSize % TILE_WIDTH;
  if (includePartial && tail > 0) {
    const n = fullTiles;
    const skip = Math.max(0, next - n * TILE_WIDTH);
    if (skip < tail) plan.push({ n, width: tail, skip });
  }
  return plan;
}
