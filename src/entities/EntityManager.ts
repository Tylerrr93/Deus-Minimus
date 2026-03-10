// ============================================================
// ENTITY MANAGER
// ============================================================

import { EntityState, EntityRole, createEntity, createGenes, inheritSkills } from './Entity';
import { BEHAVIOUR_PIPELINES, BehaviourContext, BehaviourFn } from './Behaviours';
import { World } from '../world/World';
import { TILE_PASSABLE } from '../world/Tile';
import { SpatialGrid } from './SpatialGrid';
import { ENTITY, SETTLEMENT, WORLD } from '../config/constants';
import { SettlementManager } from './SettlementManager';

export class EntityManager {
  private entities:  Map<number, EntityState> = new Map();
  private aliveIds:  Set<number>              = new Set();
  private grid:      SpatialGrid;

  private _totalBirths        = 0;
  private _totalDeaths        = 0;
  private _resourcesExtracted = 0;

  constructor(
    private readonly world:       World,
    private readonly settlements: SettlementManager,
  ) {
    this.grid = new SpatialGrid(WORLD.COLS, WORLD.ROWS, 8);
  }

  // ── Spawning ─────────────────────────────────────────────

  spawn(type: EntityRole, x: number, y: number, genes?: any, skills?: any): EntityState | null {
    const tile = this.world.getTile(x, y);
    if (!tile || !TILE_PASSABLE[tile.type]) return null;

    const e = createEntity(type, x, y, genes, skills);
    this.entities.set(e.id, e);
    this.aliveIds.add(e.id);
    this.grid.insert(e.id, x, y);
    tile.occupied = true;
    this._totalBirths++;
    return e;
  }

  spawnAtRandom(type: EntityRole, count: number, genes?: any): void {
    let spawned = 0, attempts = count * 20;
    while (spawned < count && attempts-- > 0) {
      const tile = this.world.getRandomPassableTile();
      if (tile && this.spawn(type, tile.x, tile.y, genes)) spawned++;
    }
  }

  // ── Tick ─────────────────────────────────────────────────

  tick(tickNum: number): void {
    const nowMs = performance.now();
    const toRemove: number[] = [];
    const toSpawn: Array<{
      x: number; y: number;
      genes: any; skills: any; parentId: number;
      settlementId: number; homeSettlement: [number,number]|null;
    }> = [];

    for (const id of this.aliveIds) {
      const entity = this.entities.get(id);
      if (!entity || !entity.alive) continue;

      // All entities share the single universal pipeline
      const pipeline: BehaviourFn[] = BEHAVIOUR_PIPELINES[entity.type] ?? [];

      const nearIds = this.grid.query(entity.x, entity.y, ENTITY.VISION_RANGE);
      const neighbours: EntityState[] = [];
      for (const nid of nearIds) {
        if (nid === id) continue;
        const ne = this.entities.get(nid);
        if (ne && ne.alive) neighbours.push(ne);
      }

      const ctx: BehaviourContext = {
        entity, world: this.world, neighbours,
        allEntities: this.entities,
        tick: tickNum,
        nowMs,
        settlements: this.settlements,
      };

      let didBuild = false;

      for (const behaviour of pipeline) {
        const result = behaviour(ctx);

        if (result.die) {
          entity.alive = false;
          toRemove.push(id);
          break;
        }

        if (result.eat) {
          entity.energy = Math.min(1, entity.energy + result.eat * 0.4);
          entity.memory.ticksSinceFood = 0;
        }

        if (result.reproduce) {
          const near = this.world.findPassableTileNear(entity.x, entity.y, 3);
          if (near) {
            const otherParent = result.reproduceWith
              ? this.entities.get(result.reproduceWith)
              : undefined;
            toSpawn.push({
              x: near.x, y: near.y,
              genes:  createGenes(entity.genes, otherParent?.genes),
              skills: inheritSkills(entity.skills, otherParent?.skills),
              parentId: entity.id,
              settlementId:    entity.settlementId,
              homeSettlement:  entity.memory.homeSettlement,
            });
          }
        }

        if (result.extractResource) {
          this._resourcesExtracted += result.extractResource.amount;
        }

        if (result.depositFood && entity.settlementId !== -1) {
          this.settlements.depositFood(entity.settlementId, result.depositFood);
        }

        if (result.workOnProject) {
          didBuild = true;
          const { projectId, tileX, tileY } = result.workOnProject;
          this.settlements.advanceProject(projectId, tileX, tileY, entity.id, SETTLEMENT.BUILD_RATE);
        }

        if ((result.dx !== undefined || result.dy !== undefined) && !result.die) {
          const nx = entity.x + (result.dx ?? 0);
          const ny = entity.y + (result.dy ?? 0);
          this.moveEntity(entity, nx, ny);
        }
      }

      // Clear building project if entity didn't actively build this tick
      if (!didBuild) {
        entity.buildingProjectId = -1;
      }
    }

    // Deaths
    for (const id of toRemove) {
      const e = this.entities.get(id);
      if (e) {
        const tile = this.world.getTile(e.x, e.y);
        if (tile) tile.occupied = false;
        this.grid.remove(id, e.x, e.y);
        this.entities.delete(id);
        this.aliveIds.delete(id);
        this._totalDeaths++;
      }
    }

    // Births
    for (const s of toSpawn) {
      const born = this.spawn('wanderer', s.x, s.y, s.genes, s.skills);
      if (born) {
        born.isChild  = true;
        born.parentId = s.parentId;
        born.settlementId          = s.settlementId;
        born.memory.homeSettlement = s.homeSettlement;
        if (born.settlementId !== -1) {
          const settlement = this.settlements.getById(born.settlementId);
          if (settlement) settlement.population++;
        }
      }
    }
  }

  // ── Movement ─────────────────────────────────────────────

  private moveEntity(entity: EntityState, nx: number, ny: number): void {
    const newTile = this.world.getTile(nx, ny);
    if (!newTile || !TILE_PASSABLE[newTile.type] || newTile.occupied) return;
    const oldTile = this.world.getTile(entity.x, entity.y);
    if (oldTile) oldTile.occupied = false;
    this.grid.move(entity.id, entity.x, entity.y, nx, ny);
    entity.x = nx; entity.y = ny;
    newTile.occupied = true;
    entity.energy -= 0.0005;
  }

  // ── Settlement assignment ────────────────────────────────

  assignToSettlement(entity: EntityState, settlementId: number): void {
    entity.settlementId = settlementId;
    const s = this.settlements.getById(settlementId);
    if (s) {
      entity.memory.homeSettlement = [s.x, s.y];
      s.population++;
    }
  }

  // ── Read API ─────────────────────────────────────────────

  forEachAlive(cb: (e: EntityState) => void): void {
    for (const id of this.aliveIds) {
      const e = this.entities.get(id);
      if (e) cb(e);
    }
  }

  getAlive(): EntityState[] {
    const result: EntityState[] = [];
    for (const id of this.aliveIds) {
      const e = this.entities.get(id);
      if (e) result.push(e);
    }
    return result;
  }

  getCount(): number { return this.aliveIds.size; }

  get totalBirths():        number { return this._totalBirths; }
  get totalDeaths():        number { return this._totalDeaths; }
  get resourcesExtracted(): number { return this._resourcesExtracted; }

  getTypeDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const id of this.aliveIds) {
      const e = this.entities.get(id);
      if (e) dist[e.type] = (dist[e.type] ?? 0) + 1;
    }
    return dist;
  }
}
