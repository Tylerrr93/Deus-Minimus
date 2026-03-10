import { Tile, TileType, TileResource, TILE_PASSABLE } from './Tile';
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
    const rng = Math.sin(x * 127.1 + y * 311.7) * 0.5 + 0.5;
    const rng2 = Math.sin(x * 269.5 + y * 183.3) * 0.5 + 0.5;

    if (type === 'plains' || type === 'forest') {
      resources.push({ type: 'food', amount: 2 + rng * 3, max: 8, regenRate: 0.01 });
    }
    if (type === 'forest') {
      resources.push({ type: 'wood', amount: 5 + rng2 * 5, max: 15, regenRate: 0.005 });
    }
    if (type === 'mountain') {
      if (rng > 0.4) resources.push({ type: 'stone', amount: 10 + rng * 10, max: 30, regenRate: 0 });
      if (rng2 > 0.6) resources.push({ type: 'iron', amount: 3 + rng * 5, max: 20, regenRate: 0 });
    }
    if (type === 'plains' && rng > 0.85) {
      resources.push({ type: 'coal', amount: 2 + rng2 * 4, max: 20, regenRate: 0 });
    }
    return resources;
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return this.tiles[y][x];
  }

  isPassable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile ? TILE_PASSABLE[tile.type] && !tile.occupied : false;
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
          if (t && TILE_PASSABLE[t.type] && !t.occupied) return t;
        }
      }
    }
    return null;
  }

  tick(): void {
    // Regen resources
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const tile = this.tiles[y][x];
        for (const res of tile.resources) {
          if (res.amount < res.max) {
            res.amount = Math.min(res.max, res.amount + res.regenRate);
          }
        }
      }
    }
  }

  extractResource(x: number, y: number, type: string, amount: number): number {
    const tile = this.getTile(x, y);
    if (!tile) return 0;
    const res = tile.resources.find(r => r.type === type);
    if (!res) return 0;
    const extracted = Math.min(res.amount, amount);
    res.amount -= extracted;
    return extracted;
  }

  getRandomPassableTile(): Tile | null {
    let attempts = 200;
    while (attempts-- > 0) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      const tile = this.getTile(x, y);
      if (tile && TILE_PASSABLE[tile.type] && !tile.occupied) return tile;
    }
    return null;
  }

  get width(): number { return this.cols * this.tileSize; }
  get height(): number { return this.rows * this.tileSize; }
}
