// ============================================================
// ENTITY MANAGER
// Orchestrates all living entities each tick.
//
// PERFORMANCE:
//   - SpatialGrid replaces O(n²) neighbour scan with O(k) local lookup
//   - aliveIds Set avoids re-filtering every frame
//   - forEachAlive() allows renderer to iterate without allocation
// ============================================================

import { EntityState, EntityType, createEntity, createGenes } from './Entity';
import { BEHAVIOUR_PIPELINES, BehaviourContext, BehaviourFn } from './Behaviours';
import { World } from '../world/World';
import { TILE_PASSABLE } from '../world/Tile';
import { SpatialGrid } from './SpatialGrid';
import { SettlementManager } from './SettlementManager';
import { WORLD } from '../config/constants';

export class EntityManager {
  private entities: Map<number, EntityState> = new Map();
  /** Live set of alive entity IDs — avoids filter() every frame. */
  private aliveIds: Set<number> = new Set();
  private grid: SpatialGrid;

  private _totalBirths  = 0;
  private _totalDeaths  = 0;
  private _resourcesExtracted = 0;

  constructor(
    private readonly world: World,
    private readonly hasMechanic: (name: string) => boolean,
    private readonly settlements: SettlementManager,
  ) {
    this.grid = new SpatialGrid(WORLD.COLS, WORLD.ROWS, 8);
  }

  // ── Spawning ─────────────────────────────────────────────

  spawn(
    type: EntityType,
    x: number, y: number,
    genes?: any,
    tribeId: number = -1,
  ): EntityState | null {
    const tile = this.world.getTile(x, y);
    if (!tile || !TILE_PASSABLE[tile.type]) return null;

    const e = createEntity(type, x, y, genes, tribeId);
    this.entities.set(e.id, e);
    this.aliveIds.add(e.id);
    this.grid.insert(e.id, x, y);
    tile.occupied = true;
    this._totalBirths++;
    return e;
  }

  spawnAtRandom(type: EntityType, count: number, genes?: any): void {
    let spawned = 0, attempts = count * 20;
    while (spawned < count && attempts-- > 0) {
      const tile = this.world.getRandomPassableTile();
      if (tile && this.spawn(type, tile.x, tile.y, genes)) spawned++;
    }
  }

  // ── Tick ─────────────────────────────────────────────────

  tick(tickNum: number): void {
    const toRemove: number[] = [];
    const toSpawn: Array<{ type: EntityType; x: number; y: number; genes: any; tribeId: number }> = [];

    for (const id of this.aliveIds) {
      const entity = this.entities.get(id);
      if (!entity || !entity.alive) continue;

      const pipeline: BehaviourFn[] = BEHAVIOUR_PIPELINES[entity.type] ?? [];

      // ── Cheap spatial neighbour lookup ────────────────────
      const nearIds = this.grid.query(entity.x, entity.y, 8);
      const neighbours: EntityState[] = [];
      for (const nid of nearIds) {
        if (nid === id) continue;
        const ne = this.entities.get(nid);
        if (ne && ne.alive) neighbours.push(ne);
      }

      const ctx: BehaviourContext = {
        entity, world: this.world, neighbours,
        tick: tickNum,
        hasMechanic: this.hasMechanic,
        settlements: this.settlements,
      };

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
            const childType = this.specializeChild(entity.type, entity);
            toSpawn.push({
              type: childType,
              x: near.x, y: near.y,
              genes: createGenes(entity.genes),
              tribeId: entity.tribeId,
            });
          }
        }

        if (result.extractResource) {
          this._resourcesExtracted += result.extractResource.amount;
        }

        if (result.depositFood) {
          if (entity.settlementId !== -1) {
            this.settlements.depositFood(entity.settlementId, result.depositFood);
          }
        }

        if (result.researchTick && entity.settlementId !== -1) {
          const s = this.settlements.getById(entity.settlementId);
          if (s) s.techPoints += result.researchTick;
        }

        if ((result.dx !== undefined || result.dy !== undefined) && !result.die) {
          const nx = entity.x + (result.dx ?? 0);
          const ny = entity.y + (result.dy ?? 0);
          this.moveEntity(entity, nx, ny);
        }
      }
    }

    // ── Deaths ────────────────────────────────────────────
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

    // ── Births ────────────────────────────────────────────
    for (const s of toSpawn) {
      const born = this.spawn(s.type, s.x, s.y, s.genes, s.tribeId);
      if (born) {
        // Inherit settlement
        const parent = [...this.entities.values()].find(e =>
          Math.abs(e.x - s.x) <= 4 && Math.abs(e.y - s.y) <= 4 && e.tribeId === s.tribeId
        );
        if (parent) {
          born.settlementId = parent.settlementId;
          born.memory.homeSettlement = parent.memory.homeSettlement;
        }
        // Update settlement population count
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

    entity.x = nx;
    entity.y = ny;
    newTile.occupied = true;
    entity.energy -= 0.0005;
  }

  // ── Specialization ───────────────────────────────────────

  /**
   * Child type is determined by parent's stage, tribe prosperity, and genes.
   * Specialization only unlocks when the appropriate mechanic is active.
   */
  private specializeChild(parentType: EntityType, parent: EntityState): EntityType {
    // Hunter-gatherers can settle once 'settlements' mechanic is unlocked
    if (parentType === 'hunter_gatherer' && this.hasMechanic('settlements')) {
      if (parent.tribeId !== -1 && Math.random() < 0.3) return 'villager';
    }

    // Villagers specialize based on dominant gene and available mechanics
    if (parentType === 'villager') {
      const g = parent.genes;
      if (this.hasMechanic('farming') && g.creativity > 0.55 && Math.random() < 0.15) return 'farmer';
      if (this.hasMechanic('basic_tools') && g.strength > 0.55 && Math.random() < 0.15) return 'craftsman';
      if (this.hasMechanic('warfare') && g.strength > 0.65 && Math.random() < 0.1) return 'warrior';
      if (this.hasMechanic('trade') && g.sociability > 0.65 && Math.random() < 0.08) return 'merchant';
      if (this.hasMechanic('writing') && g.intelligence > 0.65 && Math.random() < 0.05) return 'scholar';
    }

    // Scholars occasionally produce nobles
    if (parentType === 'scholar' && this.hasMechanic('governance') && parent.genes.ambition > 0.7 && Math.random() < 0.04) {
      return 'noble';
    }

    return parentType;
  }

  // ── Settlement assignment ────────────────────────────────

  /** Assign entity to a settlement (called by Simulation on new settlement founding). */
  assignToSettlement(entity: EntityState, settlementId: number): void {
    entity.settlementId = settlementId;
    const s = this.settlements.getById(settlementId);
    if (s) {
      entity.memory.homeSettlement = [s.x, s.y];
      s.population++;
    }
  }

  // ── Read API ─────────────────────────────────────────────

  /** Zero-allocation iteration for the renderer. */
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
