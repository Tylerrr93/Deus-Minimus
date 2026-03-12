import { Tile, TileType, TileResource, TILE_PASSABLE, REGEN_CRASH_TICKS, REGEN_CRASH_FRACTION } from './Tile';
import { SimplexNoise } from './SimplexNoise';
import { WORLD } from '../config/constants';

export class World {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  private tiles: Tile[][];
  private noise: SimplexNoise;
  readonly seed: number;

  constructor(seed?: number) {
    this.cols = WORLD.COLS;
    this.rows = WORLD.ROWS;
    this.tileSize = WORLD.TILE_SIZE;
    this.seed = seed ?? Math.random();
    this.noise = new SimplexNoise(this.seed);
    this.tiles = [];
    this.generate();
  }

  private generate(): void {
    for (let y = 0; y < this.rows; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.cols; x++) {
        const nx = x / this.cols;
        const ny = y / this.rows;

        // Multi-octave elevation
        let elevation = this.noise.fbm(nx * 3, ny * 3, 6, 0.55, 2.1);

        // Falloff from edges creates continents
        const dx = Math.abs(nx - 0.5) * 2;
        const dy = Math.abs(ny - 0.5) * 2;
        const edgeFalloff = 1 - Math.pow(Math.max(dx, dy), 2.5);
        elevation = elevation * 0.7 + edgeFalloff * 0.3;
        elevation = Math.max(0, Math.min(1, elevation));

        const moisture = this.noise.fbm(nx * 4 + 100, ny * 4 + 100, 4, 0.5, 2);
        const fertility = this.noise.fbm(nx * 5 + 200, ny * 5 + 200, 3, 0.5, 2);

        const type = this.elevationToType(elevation);
        const resources = this.generateResources(type, x, y);

        this.tiles[y][x] = {
          x, y, type, elevation,
          fertility,
          moisture,
          resources,
          occupied: false,
          pollution: 0,
          claimed: -1,
        };
      }
    }
  }

  private elevationToType(e: number): TileType {
    if (e < WORLD.DEEP_WATER)    return 'deep_water';
    if (e < WORLD.SHALLOW_WATER) return 'shallow_water';
    if (e < WORLD.BEACH)         return 'beach';
    if (e < WORLD.PLAINS)        return 'plains';
    if (e < WORLD.FOREST)        return 'forest';
    if (e < WORLD.MOUNTAIN)      return 'mountain';
    return 'peak';
  }

  private generateResources(type: TileType, x: number, y: number): TileResource[] {
    const resources: TileResource[] = [];
    const rng  = Math.sin(x * 127.1 + y * 311.7) * 0.5 + 0.5;
    const rng2 = Math.sin(x * 269.5 + y * 183.3) * 0.5 + 0.5;

    const makeRes = (
      resType: TileResource['type'],
      amount: number,
      max: number,
      baseRegenRate: number,
    ): TileResource => ({
      type: resType,
      amount,
      max,
      baseRegenRate,
      regenRate: baseRegenRate,
      regenCrashTicks: 0,
    });

    // ── Food: reduced max and regen so it actually runs out under pressure ──
    //amount 1-3, max 5, regen 0.004
    if (type === 'plains') {
      resources.push(makeRes('food', 1 + rng * 2, 5, 0.0004));
    }
    if (type === 'forest') {
      // Forest is slightly richer than plains but still scarce
      resources.push(makeRes('food', 1.5 + rng * 2, 6, 0.005));
      resources.push(makeRes('wood', 5 + rng2 * 5, 15, 0.005));
    }
    if (type === 'mountain') {
      if (rng  > 0.4) resources.push(makeRes('stone', 10 + rng  * 10, 30, 0));
      if (rng2 > 0.6) resources.push(makeRes('iron',   3 + rng  *  5, 20, 0));
    }
    if (type === 'plains' && rng > 0.85) {
      resources.push(makeRes('coal', 2 + rng2 * 4, 20, 0));
    }
    return resources;
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.tiles[y][x];
  }

  isPassable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    // Note: occupied no longer blocks movement — tiles can be shared
    return tile ? TILE_PASSABLE[tile.type] : false;
  }

  getNeighbours(x: number, y: number, range: number = 1): Tile[] {
    const result: Tile[] = [];
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = this.getTile(x + dx, y + dy);
        if (t) result.push(t);
      }
    }
    return result;
  }

  getPassableNeighbours(x: number, y: number): Tile[] {
    return this.getNeighbours(x, y, 1).filter(t => TILE_PASSABLE[t.type]);
  }

  findPassableTileNear(x: number, y: number, radius: number = 10): Tile | null {
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const t = this.getTile(x + dx, y + dy);
          // Tiles are shareable now — only check terrain passability
          if (t && TILE_PASSABLE[t.type]) return t;
        }
      }
    }
    return null;
  }

  tick(): void {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const tile = this.tiles[y][x];
        for (const res of tile.resources) {
          if (res.regenCrashTicks > 0) {
            res.regenCrashTicks--;
            if (res.regenCrashTicks === 0) {
              res.regenRate = res.baseRegenRate;
            }
          }
          if (res.amount < res.max) {
            res.amount = Math.min(res.max, res.amount + res.regenRate);
          }
        }
      }
    }
  }

  /**
   * Extract `amount` of `type` from tile (x, y).
   */
  extractResource(x: number, y: number, type: string, amount: number): number {
    const tile = this.getTile(x, y);
    if (!tile) return 0;
    const res = tile.resources.find(r => r.type === type);
    if (!res) return 0;

    const wasAboveZero = res.amount > 0;
    const extracted = Math.min(res.amount, amount);
    res.amount -= extracted;

    if (type === 'food' && wasAboveZero && res.amount <= 0 && res.regenCrashTicks === 0) {
      res.regenRate = res.baseRegenRate * REGEN_CRASH_FRACTION;
      res.regenCrashTicks = REGEN_CRASH_TICKS;
    }

    return extracted;
  }

  getRandomPassableTile(): Tile | null {
    let attempts = 200;
    while (attempts-- > 0) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      const tile = this.getTile(x, y);
      if (tile && TILE_PASSABLE[tile.type]) return tile;
    }
    return null;
  }

  get width():  number { return this.cols * this.tileSize; }
  get height(): number { return this.rows * this.tileSize; }
}