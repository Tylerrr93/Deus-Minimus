// ============================================================
// SETTLEMENT MANAGER
// Settlements form dynamically when entities cluster.
// Tracks shared inventory and manages building projects.
//
// REWORK 2 ADDITIONS (on top of original):
//  - NeedsMatrix: Food / Wood / Tech need scores recalculated
//    every SIM.NEEDS_RECALC_INTERVAL ticks via tickNeeds().
//  - Dynamic Task Assignment: assignTasks() sets entity.currentTask.
//  - Agrarian Shift: farm plot designation once techPoints threshold met.
//  - EntityTask type, NeedsMatrix interface, agriUnlocked / farmPlots /
//    foodCrisisTicks / needs fields added to Settlement.
// ============================================================

import { World } from '../world/World';
import { TILE_PASSABLE } from '../world/Tile';
import { ENTITY, SETTLEMENT, SIM } from '../config/constants';
import { EntityState } from './Entity';

// ── Types ─────────────────────────────────────────────────────

/** Task assigned by the Settlement Brain. Checked by task-gated behaviours. */
export type EntityTask =
  | 'idle'
  | 'gather'
  | 'wood'
  | 'build'
  | 'farm'
  | 'mine'
  | 'trade';

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

export type SettlementLevel = 1 | 2 | 3;

export const LEVEL_NAMES: Record<SettlementLevel, string> = {
  1: 'Campsite',
  2: 'Hamlet',
  3: 'Village',
};

export interface NeedsMatrix {
  food: number;  // 0 = full, 1 = empty
  wood: number;  // 0 = plenty, 1 = critically needed
  tech: number;  // 0 = no pressure, 1 = blocked
}

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
  techPoints:   number;
  age:          number;
  homesBuilt:   number;
  roadsBuilt:   number;
  projects:     BuildingProject[];
  projectCooldown: number;
  justLeveledUp: boolean;

  // ── Rework 2 fields ────────────────────────────────────────
  /** Current need scores, updated every NEEDS_RECALC_INTERVAL ticks. */
  needs:           NeedsMatrix;
  /** True once techPoints >= AGRI_TECH_THRESHOLD. */
  agriUnlocked:    boolean;
  /** Tile coords of Brain-designated farm plots. */
  farmPlots:       [number, number][];
  /** Consecutive ticks food need has been in crisis (used for granary queuing). */
  foodCrisisTicks: number;
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

  checkForNewSettlements(entities: EntityState[]): Settlement[] {
    const created: Settlement[] = [];
    const unhoused = entities.filter(e => e.alive && !e.isChild && e.settlementId === -1);
    if (unhoused.length < ENTITY.CLUSTER_MIN_SIZE) return created;

    const assigned = new Set<number>();

    for (const anchor of unhoused) {
      if (assigned.has(anchor.id)) continue;

      const cluster = unhoused.filter(e =>
        !assigned.has(e.id) &&
        Math.abs(e.x - anchor.x) + Math.abs(e.y - anchor.y) <= ENTITY.CLUSTER_RADIUS,
      );
      if (cluster.length < ENTITY.CLUSTER_MIN_SIZE) continue;

      const cx = Math.round(cluster.reduce((s, e) => s + e.x, 0) / cluster.length);
      const cy = Math.round(cluster.reduce((s, e) => s + e.y, 0) / cluster.length);

      const tooClose = [...this.settlements.values()].some(s =>
        Math.abs(s.x - cx) + Math.abs(s.y - cy) < SETTLEMENT.MIN_DISTANCE,
      );
      if (tooClose) continue;

      const tile = this.world.findPassableTileNear(cx, cy, 6);
      if (!tile) continue;

      const s = this._create(tile.x, tile.y);
      if (!s) continue;

      for (const e of cluster.slice(0, 12)) {
        e.settlementId          = s.id;
        e.memory.homeSettlement = [s.x, s.y];
        s.population++;
        assigned.add(e.id);
      }

      s.foodStorage = Math.min(s.maxFoodStorage, 10);
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
      level:           1,
      population:      0,
      foodStorage:     10,
      maxFoodStorage:  30,
      woodStorage:     0,
      stoneStorage:    0,
      techPoints:      0,
      age:             0,
      homesBuilt:      0,
      roadsBuilt:      0,
      projects:        [],
      projectCooldown: 0,
      justLeveledUp:   false,
      needs:           { food: 0.5, wood: 0.5, tech: 0.5 },
      agriUnlocked:    false,
      farmPlots:       [],
      foodCrisisTicks: 0,
    };

    this.settlements.set(s.id, s);
    const t = this.world.getTile(x, y);
    if (t) t.improvement = 'settlement';
    return s;
  }

  // ── Per-tick update ───────────────────────────────────────

  tick(entities: EntityState[], tickNum: number = 0): void {
    for (const s of this.settlements.values()) {
      s.age++;
      s.justLeveledUp = false;

      s.population = entities.filter(e => e.alive && !e.isChild && e.settlementId === s.id).length;
      s.foodStorage = Math.max(0, s.foodStorage - s.population * SETTLEMENT.FOOD_PER_POP_TICK);

      // Tech drip from scholars
      const scholars = entities.filter(
        e => e.alive && !e.isChild && e.settlementId === s.id && e.type === 'scholar',
      );
      s.techPoints += scholars.length * 0.002;

      // Unlock agrarian shift
      if (!s.agriUnlocked && s.techPoints >= SETTLEMENT.AGRI_TECH_THRESHOLD) {
        s.agriUnlocked = true;
      }

      this._checkLevelUp(s);

      if (s.projectCooldown > 0) {
        s.projectCooldown--;
      } else {
        this._generateProjects(s);
      }

      for (const p of s.projects) {
        if (!p.complete) {
          p.workerIds = p.workerIds.filter(id => entities.find(e => e.id === id && e.alive));
        }
      }

      // Settlement Brain — runs on the recalc interval
      if (tickNum > 0 && tickNum % SIM.NEEDS_RECALC_INTERVAL === 0) {
        const residents = entities.filter(e => e.alive && e.settlementId === s.id);
        this.tickNeeds(s);
        this.assignTasks(s, residents);
        if (s.agriUnlocked) this._designateFarmPlots(s);
      }
    }
  }

  private _checkLevelUp(s: Settlement): void {
    const prev = s.level;
    if (s.level === 1 &&
        s.population  >= SETTLEMENT.LEVEL2_POP &&
        s.foodStorage >= SETTLEMENT.LEVEL2_FOOD) {
      s.level          = 2;
      s.maxFoodStorage = 50;
    }
    if (s.level === 2 &&
        s.population >= SETTLEMENT.LEVEL3_POP &&
        s.homesBuilt >= SETTLEMENT.LEVEL3_HOMES) {
      s.level          = 3;
      s.maxFoodStorage = 100;
    }
    if (s.level !== prev) {
      s.justLeveledUp = true;
      const t = this.world.getTile(s.x, s.y);
      if (t) t.improvement = 'settlement';
    }
  }

  // ── Needs Matrix (Rework 2) ───────────────────────────────

  tickNeeds(s: Settlement): void {
    s.needs.food = 1.0 - Math.min(1, s.foodStorage / s.maxFoodStorage);

    if (s.needs.food >= SETTLEMENT.CRISIS_FOOD_NEED) {
      s.foodCrisisTicks++;
    } else {
      s.foodCrisisTicks = 0;
    }

    const activeProjects = s.projects.filter(p => !p.complete);
    s.needs.wood = activeProjects.length > 0
      ? 1.0 - Math.min(1, s.woodStorage / SETTLEMENT.WOOD_NEED_BUILD_TARGET)
      : 0.1;

    s.needs.tech = 0.4;
  }

  // ── Dynamic Task Assignment (Rework 2) ───────────────────

  assignTasks(s: Settlement, residents: EntityState[]): void {
    const adults = residents.filter(e => !e.isChild && e.energy > 0.15);
    if (adults.length === 0) return;

    const { food, wood } = s.needs;

    if (food >= SETTLEMENT.CRISIS_FOOD_NEED) {
      for (const e of adults) e.currentTask = 'gather';
      return;
    }

    for (const e of adults) {
      if (e.energy < 0.35) e.currentTask = 'gather';
    }

    const free = adults.filter(e => e.energy >= 0.35);

    if (food >= SETTLEMENT.IDLE_FOOD_NEED) {
      const gathererTarget = Math.ceil(free.length * 0.6);
      free.forEach((e, i) => {
        const hasProject = s.projects.some(p => !p.complete);
        e.currentTask = i < gathererTarget
          ? 'gather'
          : hasProject ? 'build' : (wood > 0.5 ? 'wood' : 'gather');
      });
      return;
    }

    const sorted = [...free].sort((a, b) => b.skills.farming - a.skills.farming);
    let farmerSlots     = s.agriUnlocked && s.farmPlots.length > 0
      ? Math.min(s.farmPlots.length, Math.floor(free.length * 0.5))
      : 0;
    let woodcutterSlots = wood >= 0.5 ? Math.max(1, Math.floor(free.length * 0.25)) : 0;
    let builderSlots    = s.projects.some(p => !p.complete)
      ? Math.max(1, Math.floor(free.length * 0.20))
      : 0;

    sorted.forEach((e, i) => {
      if      (i < farmerSlots)                                  e.currentTask = 'farm';
      else if (i < farmerSlots + woodcutterSlots)                e.currentTask = 'wood';
      else if (i < farmerSlots + woodcutterSlots + builderSlots) e.currentTask = 'build';
      else                                                       e.currentTask = food < 0.2 ? 'idle' : 'gather';
    });
  }

  // ── Agrarian Shift (Rework 2) ─────────────────────────────

  private _designateFarmPlots(s: Settlement): void {
    const maxPlots = s.level * SETTLEMENT.AGRI_FARM_SLOTS_PER_LVL;
    if (s.farmPlots.length >= maxPlots) return;

    const R = SETTLEMENT.AGRI_SEARCH_RADIUS;
    const candidates: [number, number, number][] = [];

    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = s.x + dx, ty = s.y + dy;
        const tile = this.world.getTile(tx, ty);
        if (!tile || tile.type !== 'plains' || tile.improvement) continue;
        if (s.farmPlots.some(([px, py]) => px === tx && py === ty)) continue;
        candidates.push([tx, ty, Math.abs(dx) + Math.abs(dy)]);
      }
    }

    candidates.sort((a, b) => a[2] - b[2]);

    for (const [tx, ty] of candidates) {
      if (s.farmPlots.length >= maxPlots) break;
      const tile = this.world.getTile(tx, ty);
      if (!tile) continue;
      tile.improvement = 'farm';
      s.farmPlots.push([tx, ty]);
    }
  }

  // ── Project generation ────────────────────────────────────

  private _generateProjects(s: Settlement): void {
    if (s.level < 2) return;
    const active = s.projects.filter(p => !p.complete);
    if (active.length >= SETTLEMENT.MAX_ACTIVE_PROJECTS) return;

    const needHome = s.homesBuilt < Math.floor(s.population / 3) + 1;
    const needRoad = s.roadsBuilt < 3 + (s.level - 1);

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

  getAvailableProject(settlementId: number, entityId: number): BuildingProject | null {
    const s = this.settlements.get(settlementId);
    if (!s) return null;
    for (const p of s.projects) {
      if (p.complete) continue;
      if (p.workerIds.includes(entityId)) return p;
      if (p.workerIds.length < p.maxWorkers) return p;
    }
    return null;
  }

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

  found(x: number, y: number): Settlement | null {
    const tile = this.world.findPassableTileNear(x, y, 4);
    if (!tile) return null;
    return this._create(tile.x, tile.y);
  }

  // ── Tech points ───────────────────────────────────────────

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

  // ── Queries ───────────────────────────────────────────────

  getAll(): Settlement[]                 { return [...this.settlements.values()]; }
  getById(id: number): Settlement | null { return this.settlements.get(id) ?? null; }
  getCount(): number                     { return this.settlements.size; }

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

  isTooClose(x: number, y: number): boolean {
    for (const s of this.settlements.values()) {
      if (Math.abs(s.x - x) + Math.abs(s.y - y) < SETTLEMENT.MIN_DISTANCE) return true;
    }
    return false;
  }
}