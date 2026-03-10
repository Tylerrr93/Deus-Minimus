// ============================================================
// SETTLEMENT MANAGER
// Settlements form dynamically when entities cluster.
// Tracks shared inventory and manages building projects.
// ============================================================

import { World } from '../world/World';
import { TILE_PASSABLE } from '../world/Tile';
import { ENTITY, SETTLEMENT } from '../config/constants';
import { EntityState } from './Entity';

// ── Building Projects ─────────────────────────────────────────

export type ProjectType = 'dirt_road' | 'rough_home';

export interface BuildingProject {
  id:           number;
  settlementId: number;
  type:         ProjectType;
  /** Ordered list of world tiles this project spans */
  tiles:        [number, number][];
  /** Per-tile progress 0→1 */
  progressPerTile: number[];
  /** Overall progress 0→1 (mean of per-tile) */
  progress:     number;
  workerIds:    number[];
  maxWorkers:   number;
  complete:     boolean;
}

// ── Settlement ────────────────────────────────────────────────

export type SettlementLevel = 1 | 2 | 3;

export const LEVEL_NAMES: Record<SettlementLevel, string> = {
  1: 'Campsite',
  2: 'Hamlet',
  3: 'Village',
};

export interface Settlement {
  id:           number;
  name:         string;
  x:            number;
  y:            number;
  level:        SettlementLevel;
  population:   number;
  foodStorage:  number;
  maxFoodStorage: number;
  woodStorage:  number;
  stoneStorage: number;
  /** Accumulated technology points driving research and era progression */
  techPoints:   number;
  age:          number;
  homesBuilt:   number;
  roadsBuilt:   number;
  projects:     BuildingProject[];
  projectCooldown: number;
  /** Set to true when level just changed, for notification */
  justLeveledUp: boolean;
}

// ── Name pool ─────────────────────────────────────────────────

const NAMES = [
  'Ashenvale','Dunmark','Ironholt','Goldenfield','Westmere',
  'Stonegate','Oakhaven','Dawnkeep','Thornwall','Brightwater',
  'Crowspire','Emberveil','Greyhaven','Moorfield','Salthollow',
  'Crestfall','Deepmoor','Frostpeak','Grimhold','Halloway',
  'Ironwood','Jadepond','Kingsbluff','Lochdale','Mirepoint',
  'Northfen','Oldstoke','Pinewood','Quarryham','Ravenmoor',
];

let _nameIdx       = 0;
let _nextId        = 1;
let _nextProjectId = 1;

// ── Manager ───────────────────────────────────────────────────

export class SettlementManager {
  private settlements: Map<number, Settlement> = new Map();

  constructor(private readonly world: World) {}

  // ── Dynamic formation ─────────────────────────────────────

  /**
   * Scans unhoused entities for clusters large enough to form a settlement.
   * Returns newly founded settlements (callers can push notifications).
   */
  checkForNewSettlements(entities: EntityState[]): Settlement[] {
    const created: Settlement[] = [];

    const unhoused = entities.filter(e => e.alive && !e.isChild && e.settlementId === -1);
    if (unhoused.length < ENTITY.CLUSTER_MIN_SIZE) return created;

    const assigned = new Set<number>();

    for (const anchor of unhoused) {
      if (assigned.has(anchor.id)) continue;

      // Collect nearby unhoused entities
      const cluster = unhoused.filter(e =>
        !assigned.has(e.id) &&
        Math.abs(e.x - anchor.x) + Math.abs(e.y - anchor.y) <= ENTITY.CLUSTER_RADIUS,
      );

      if (cluster.length < ENTITY.CLUSTER_MIN_SIZE) continue;

      // Find centroid
      const cx = Math.round(cluster.reduce((s, e) => s + e.x, 0) / cluster.length);
      const cy = Math.round(cluster.reduce((s, e) => s + e.y, 0) / cluster.length);

      // Enforce minimum distance between settlements
      const tooClose = [...this.settlements.values()].some(s =>
        Math.abs(s.x - cx) + Math.abs(s.y - cy) < SETTLEMENT.MIN_DISTANCE,
      );
      if (tooClose) continue;

      const tile = this.world.findPassableTileNear(cx, cy, 6);
      if (!tile) continue;

      const s = this._create(tile.x, tile.y);
      if (!s) continue;

      // Assign up to 12 cluster members
      for (const e of cluster.slice(0, 12)) {
        e.settlementId            = s.id;
        e.memory.homeSettlement   = [s.x, s.y];
        s.population++;
        assigned.add(e.id);
      }

      created.push(s);
    }

    return created;
  }

  private _create(x: number, y: number): Settlement | null {
    const tile = this.world.getTile(x, y);
    if (!tile || !TILE_PASSABLE[tile.type]) return null;

    for (const s of this.settlements.values()) {
      if (Math.abs(s.x - x) + Math.abs(s.y - y) < SETTLEMENT.MIN_DISTANCE) return null;
    }

    const s: Settlement = {
      id:   _nextId++,
      name: NAMES[_nameIdx++ % NAMES.length],
      x, y,
      level: 1,
      population:     0,
      foodStorage:    5,
      maxFoodStorage: 20,
      woodStorage:    0,
      stoneStorage:   0,
      techPoints:     0,
      age:            0,
      homesBuilt:     0,
      roadsBuilt:     0,
      projects:       [],
      projectCooldown: 0,
      justLeveledUp:  false,
    };

    this.settlements.set(s.id, s);

    const t = this.world.getTile(x, y);
    if (t) t.improvement = 'settlement';

    return s;
  }

  // ── Per-tick update ───────────────────────────────────────

  tick(entities: EntityState[]): void {
    for (const s of this.settlements.values()) {
      s.age++;
      s.justLeveledUp = false;

      // Recount living adult population
      s.population = entities.filter(e => e.alive && !e.isChild && e.settlementId === s.id).length;

      // Consume food
      s.foodStorage = Math.max(0, s.foodStorage - s.population * SETTLEMENT.FOOD_PER_POP_TICK);

      // Level progression
      this._checkLevelUp(s);

      // Project generation & housekeeping
      if (s.projectCooldown > 0) {
        s.projectCooldown--;
      } else {
        this._generateProjects(s);
      }

      // Evict dead workers from projects
      for (const p of s.projects) {
        if (!p.complete) {
          p.workerIds = p.workerIds.filter(id => entities.find(e => e.id === id && e.alive));
        }
      }
    }
  }

  private _checkLevelUp(s: Settlement): void {
    const prev = s.level;
    if (s.level === 1 &&
        s.population    >= SETTLEMENT.LEVEL2_POP &&
        s.foodStorage   >= SETTLEMENT.LEVEL2_FOOD) {
      s.level          = 2;
      s.maxFoodStorage = 40;
    }
    if (s.level === 2 &&
        s.population >= SETTLEMENT.LEVEL3_POP &&
        s.homesBuilt >= SETTLEMENT.LEVEL3_HOMES) {
      s.level          = 3;
      s.maxFoodStorage = 80;
    }
    if (s.level !== prev) {
      s.justLeveledUp = true;
      const t = this.world.getTile(s.x, s.y);
      if (t) t.improvement = 'settlement';
    }
  }

  // ── Project generation ────────────────────────────────────

  private _generateProjects(s: Settlement): void {
    if (s.level < 2) return;

    const active = s.projects.filter(p => !p.complete);
    if (active.length >= SETTLEMENT.MAX_ACTIVE_PROJECTS) return;

    const needHome = s.homesBuilt < Math.floor(s.population / 3) + 1;
    const needRoad = s.roadsBuilt < 3 + (s.level - 1);

    // Bias toward homes first, then roads
    if (needHome && (Math.random() < 0.6 || !needRoad)) {
      const p = this._createHomeProject(s);
      if (p) { s.projects.push(p); s.projectCooldown = SETTLEMENT.PROJECT_COOLDOWN; }
    } else if (needRoad) {
      const p = this._createRoadProject(s);
      if (p) { s.projects.push(p); s.projectCooldown = SETTLEMENT.PROJECT_COOLDOWN; }
    }
  }

  private _createHomeProject(s: Settlement): BuildingProject | null {
    const range = SETTLEMENT.HOME_SEARCH_RANGE;
    for (let r = 2; r <= range; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const t = this.world.getTile(s.x + dx, s.y + dy);
          if (!t || !TILE_PASSABLE[t.type] || t.improvement) continue;
          // Don't conflict with an existing project tile
          if (this._tileInUse(s.x + dx, s.y + dy)) continue;

          return this._makeProject(s.id, 'rough_home', [[s.x + dx, s.y + dy]], 2);
        }
      }
    }
    return null;
  }

  private _createRoadProject(s: Settlement): BuildingProject | null {
    const range = SETTLEMENT.ROAD_SEARCH_RANGE;
    let bestTarget: [number, number] | null = null;
    let bestScore = 0;

    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < 8) continue;
        const t = this.world.getTile(s.x + dx, s.y + dy);
        if (!t || !TILE_PASSABLE[t.type]) continue;
        const food = t.resources.find(r => r.type === 'food');
        if (!food || food.amount < 1.5) continue;
        const score = food.amount / dist;
        if (score > bestScore) { bestScore = score; bestTarget = [s.x + dx, s.y + dy]; }
      }
    }

    if (!bestTarget) return null;

    const path = this._bresenhamPath(s.x, s.y, bestTarget[0], bestTarget[1]);
    const viable = path.filter(([tx, ty]) => {
      const t = this.world.getTile(tx, ty);
      return t && TILE_PASSABLE[t.type] &&
             t.improvement !== 'dirt_road' &&
             t.improvement !== 'settlement';
    });

    if (viable.length < 3) return null;

    return this._makeProject(s.id, 'dirt_road', viable.slice(0, 20), 4);
  }

  private _makeProject(
    settlementId: number,
    type: ProjectType,
    tiles: [number, number][],
    maxWorkers: number,
  ): BuildingProject {
    return {
      id: _nextProjectId++,
      settlementId,
      type,
      tiles,
      progressPerTile: tiles.map(() => 0),
      progress: 0,
      workerIds: [],
      maxWorkers,
      complete: false,
    };
  }

  private _bresenhamPath(x1: number, y1: number, x2: number, y2: number): [number, number][] {
    const path: [number, number][] = [];
    let x = x1, y = y1;
    let steps = 0;
    const max = Math.abs(x2 - x1) + Math.abs(y2 - y1) + 2;
    while ((x !== x2 || y !== y2) && steps++ < max) {
      if (Math.abs(x2 - x) >= Math.abs(y2 - y)) x += Math.sign(x2 - x);
      else                                        y += Math.sign(y2 - y);
      path.push([x, y]);
      if (path.length >= 25) break;
    }
    return path;
  }

  private _tileInUse(tx: number, ty: number): boolean {
    for (const s of this.settlements.values()) {
      for (const p of s.projects) {
        if (!p.complete && p.tiles.some(([x, y]) => x === tx && y === ty)) return true;
      }
    }
    return false;
  }

  // ── Building project API ──────────────────────────────────

  /** Returns a project that still needs workers from the given settlement. */
  getAvailableProject(settlementId: number, entityId: number): BuildingProject | null {
    const s = this.settlements.get(settlementId);
    if (!s) return null;
    for (const p of s.projects) {
      if (p.complete) continue;
      if (p.workerIds.includes(entityId)) return p;       // already assigned
      if (p.workerIds.length < p.maxWorkers) return p;    // open slot
    }
    return null;
  }

  /** Returns the nearest incomplete tile in the project to the entity. */
  getNearestProjectTile(project: BuildingProject, ex: number, ey: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < project.tiles.length; i++) {
      if (project.progressPerTile[i] >= 1) continue;
      const [tx, ty] = project.tiles[i];
      const d = Math.abs(tx - ex) + Math.abs(ty - ey);
      if (d < bestDist) { bestDist = d; best = [tx, ty]; }
    }
    return best;
  }

  /** Advance a specific project tile; complete the project when all tiles are done. */
  advanceProject(
    projectId: number,
    tileX: number,
    tileY: number,
    entityId: number,
    amount: number,
  ): void {
    for (const s of this.settlements.values()) {
      const p = s.projects.find(pr => pr.id === projectId);
      if (!p || p.complete) continue;

      if (!p.workerIds.includes(entityId)) p.workerIds.push(entityId);

      const idx = p.tiles.findIndex(([tx, ty]) => tx === tileX && ty === tileY);
      if (idx !== -1) {
        p.progressPerTile[idx] = Math.min(1, p.progressPerTile[idx] + amount);
      }

      const done = p.progressPerTile.filter(v => v >= 1).length;
      p.progress = done / p.tiles.length;

      if (p.progress >= 1) {
        p.complete = true;
        if (p.type === 'dirt_road') {
          for (const [tx, ty] of p.tiles) {
            const t = this.world.getTile(tx, ty);
            if (t && TILE_PASSABLE[t.type] && t.improvement !== 'settlement') {
              t.improvement = 'dirt_road';
            }
          }
          s.roadsBuilt++;
        } else if (p.type === 'rough_home') {
          const [tx, ty] = p.tiles[0];
          const t = this.world.getTile(tx, ty);
          if (t) t.improvement = 'rough_home';
          s.homesBuilt++;
        }
      }
      return;
    }
  }

  // ── God power API ─────────────────────────────────────────

  /**
   * Manually found a settlement at the given world coordinates.
   * Used by god powers (e.g. "Found Settlement"). Returns the new
   * settlement, or null if the location is impassable / too close to
   * an existing one.
   */
  found(x: number, y: number): Settlement | null {
    const tile = this.world.findPassableTileNear(x, y, 4);
    if (!tile) return null;
    return this._create(tile.x, tile.y);
  }

    // ── Tech points ───────────────────────────────────────────

  /** Add tech points to a settlement (called by scholars, events, god powers, etc.). */
  addTechPoints(settlementId: number, amount: number): void {
    const s = this.settlements.get(settlementId);
    if (s) s.techPoints += amount;
  }

  // ── Resource logistics ────────────────────────────────────

  depositFood(settlementId: number, amount: number): number {
    const s = this.settlements.get(settlementId);
    if (!s) return 0;
    const space = s.maxFoodStorage - s.foodStorage;
    const deposited = Math.min(amount, space);
    s.foodStorage += deposited;
    return deposited;
  }

  withdrawFood(settlementId: number, amount: number): number {
    const s = this.settlements.get(settlementId);
    if (!s) return 0;
    const withdrawn = Math.min(amount, s.foodStorage);
    s.foodStorage -= withdrawn;
    return withdrawn;
  }

  depositResource(settlementId: number, type: 'wood' | 'stone' | 'iron', amount: number): void {
    const s = this.settlements.get(settlementId);
    if (!s) return;
    if (type === 'wood')  s.woodStorage  = Math.min(200, s.woodStorage  + amount);
    if (type === 'stone') s.stoneStorage = Math.min(200, s.stoneStorage + amount);
  }

  // ── Queries ──────────────────────────────────────────────

  getAll(): Settlement[]                        { return [...this.settlements.values()]; }
  getById(id: number): Settlement | null        { return this.settlements.get(id) ?? null; }
  getCount(): number                            { return this.settlements.size; }

  getAllProjects(): BuildingProject[] {
    const out: BuildingProject[] = [];
    for (const s of this.settlements.values()) out.push(...s.projects);
    return out;
  }

  getLevelDistribution(): Record<string, number> {
    const d = { campsite: 0, hamlet: 0, village: 0 };
    for (const s of this.settlements.values()) {
      if      (s.level === 1) d.campsite++;
      else if (s.level === 2) d.hamlet++;
      else                    d.village++;
    }
    return d;
  }
}
