// ============================================================
// SIMULATION — master controller.
// Owns the world, entities, settlements, stages, events, god powers.
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { SettlementManager } from '../entities/SettlementManager';
import { StageManager } from '../stages/StageManager';
import { StageDefinition } from '../stages/stageDefinitions';
import { EventManager, FiredEvent } from '../events/EventManager';
import { GodPowerManager } from '../godpowers/GodPowerManager';
import { SIM, ENTITY } from '../config/constants';

export interface SimulationState {
  tick:               number;
  year:               number;
  population:         number;
  totalBirths:        number;
  totalDeaths:        number;
  resourcesExtracted: number;
  tribesFormed:       number;
  settlementsBuilt:   number;
  techDiscovered:     number;
  highestPopulation:  number;
  recentEvents:       FiredEvent[];
  stageName:          string;
  stageProgress:      number;
  favor:              number;
  typeDistribution:   Record<string, number>;
  settlementLevels:   Record<string, number>;
}

// Tribe ID counter
let _nextTribeId = 1;

export class Simulation {
  readonly world:       World;
  readonly settlements: SettlementManager;
  readonly entities:    EntityManager;
  readonly stages:      StageManager;
  readonly events:      EventManager;
  readonly godPowers:   GodPowerManager;

  private _tick          = 0;
  private _year          = 0;
  private _highestPop    = 0;
  private _tribesFormed  = 0;
  private _techDiscovered = 0;

  onStageTransition?: (prev: StageDefinition, next: StageDefinition) => void;
  onEvent?: (event: FiredEvent) => void;

  constructor(seed?: number) {
    this.world = new World(seed);

    this.stages = new StageManager((prev, next) => {
      this.onStageTransition?.(prev, next);
    });

    this.settlements = new SettlementManager(this.world);

    this.entities = new EntityManager(
      this.world,
      (mech) => this.stages.hasMechanic(mech),
      this.settlements,
    );

    this.events = new EventManager((mech) => this.stages.hasMechanic(mech));

    this.godPowers = new GodPowerManager((mech) => this.stages.hasMechanic(mech));

    // ── Initial population: hunter-gatherers scattered across the world ──
    this.entities.spawnAtRandom('hunter_gatherer', 25);
  }

  tick(): void {
    this._tick++;

    // World resource regeneration
    this.world.tick();

    // Settlement tick (food consumption, level-ups, road building)
    this.settlements.tick((m) => this.stages.hasMechanic(m));

    // Entity behaviour tick
    this.entities.tick(this._tick);

    // God power favor regen
    this.godPowers.tick();

    // Population peak tracking
    const pop = this.entities.getCount();
    if (pop > this._highestPop) this._highestPop = pop;

    // ── Yearly logic ────────────────────────────────────────
    if (this._tick % SIM.TICKS_PER_YEAR === 0) {
      this._year++;

      // Stage transition check
      this.stages.checkTransition(this.buildStats(), this.world, this.entities, this.settlements);

      // Yearly simulation logic
      this.yearlyLogic();

      // Random world events
      const ev = this.events.tick(this._year, this.buildStats(), this.world, this.entities);
      if (ev) this.onEvent?.(ev);
    }
  }

  // ── Yearly logic ──────────────────────────────────────────

  private yearlyLogic(): void {
    // Ensure minimum population
    if (this.entities.getCount() < 8) {
      this.entities.spawnAtRandom('hunter_gatherer', 6);
    }

    // ── Tribe formation ──────────────────────────────────────
    // Groups of hunter_gatherers with high sociability cluster into tribes
    if (this._year % 5 === 0) {
      this.tryFormTribes();
    }

    // ── Settlement founding ──────────────────────────────────
    // When a tribe has enough members and the right mechanics, found a settlement
    if (this.stages.hasMechanic('fire') && this._year % 8 === 0) {
      this.tryFoundSettlements();
    }

    // ── Tribe count ──────────────────────────────────────────
    const tribeIds = new Set(
      this.entities.getAlive().map(e => e.tribeId).filter(id => id !== -1)
    );
    this._tribesFormed = tribeIds.size;

    // ── Tech discovery ───────────────────────────────────────
    // Driven by accumulated settlement tech points + random scholar events
    if (this._year % 15 === 0 && this.stages.isAtOrPast('BRONZE_AGE')) {
      const totalTechPts = this.settlements.getTotalTechPoints();
      if (totalTechPts > 10 + this._techDiscovered * 8) {
        if (Math.random() < 0.4) {
          this._techDiscovered++;
          // Consume some tech points
          for (const s of this.settlements.getAll()) {
            s.techPoints = Math.max(0, s.techPoints - 3);
          }
        }
      }
    }

    // ── Intelligence drift ────────────────────────────────────
    // Scholars slowly raise average intelligence in their settlement
    if (this.stages.hasMechanic('writing') && this._year % 20 === 0) {
      const scholars = this.entities.getAlive().filter(e => e.type === 'scholar');
      for (const s of scholars) {
        const nearby = this.entities.getAlive().filter(e =>
          e.settlementId === s.settlementId && e.genes.intelligence < s.genes.intelligence
        );
        for (const n of nearby.slice(0, 3)) {
          n.genes.intelligence = Math.min(1, n.genes.intelligence + 0.01);
        }
      }
    }
  }

  private tryFormTribes(): void {
    const ungrouped = this.entities.getAlive().filter(e =>
      e.tribeId === -1 && e.type === 'hunter_gatherer'
    );

    for (const leader of ungrouped) {
      if (leader.tribeId !== -1) continue; // already assigned this pass
      if (leader.genes.sociability < 0.45) continue;

      // Find nearby ungrouped entities
      const nearby = this.entities.getAlive().filter(e =>
        e.tribeId === -1 &&
        Math.abs(e.x - leader.x) <= ENTITY.TRIBE_BOND_RADIUS &&
        Math.abs(e.y - leader.y) <= ENTITY.TRIBE_BOND_RADIUS
      );

      if (nearby.length >= 3) {
        const newTribeId = _nextTribeId++;
        for (const member of nearby.slice(0, 8)) {
          member.tribeId = newTribeId;
        }
        leader.tribeId = newTribeId;
      }
    }
  }

  private tryFoundSettlements(): void {
    // Build a map of tribe -> entity array
    const tribeMap = new Map<number, typeof this.entities.getAlive extends () => infer R ? R : never>();
    for (const e of this.entities.getAlive()) {
      if (e.tribeId === -1 || e.settlementId !== -1) continue;
      let list = tribeMap.get(e.tribeId);
      if (!list) { list = []; tribeMap.set(e.tribeId, list); }
      list.push(e);
    }

    for (const [tribeId, members] of tribeMap) {
      if (members.length < 4) continue;

      // Pick highest-ambition member as founder
      const founder = members.sort((a, b) => b.genes.ambition - a.genes.ambition)[0];
      if (founder.genes.ambition < 0.3) continue;

      // Find a good spot near the founder
      const near = this.world.findPassableTileNear(founder.x, founder.y, ENTITY.SETTLEMENT_FOUND_RADIUS);
      if (!near) continue;

      const settlement = this.settlements.found(near.x, near.y, tribeId);
      if (!settlement) continue;

      // Assign nearby tribe members to the new settlement
      for (const member of members.slice(0, Math.min(10, members.length))) {
        this.entities.assignToSettlement(member, settlement.id);
      }
    }
  }

  // ── Stats helpers ────────────────────────────────────────

  private buildStats() {
    return {
      totalEntities:      this.entities.getCount(),
      totalYears:         this._year,
      totalDeaths:        this.entities.totalDeaths,
      totalBirths:        this.entities.totalBirths,
      highestPopulation:  this._highestPop,
      resourcesExtracted: Math.floor(this.entities.resourcesExtracted),
      tribesFormed:       this._tribesFormed,
      settlementsBuilt:   this.settlements.getCount(),
      techDiscovered:     this._techDiscovered,
      stage:              this.stages.currentId,
    };
  }

  getState(): SimulationState {
    return {
      tick:               this._tick,
      year:               this._year,
      population:         this.entities.getCount(),
      totalBirths:        this.entities.totalBirths,
      totalDeaths:        this.entities.totalDeaths,
      resourcesExtracted: Math.floor(this.entities.resourcesExtracted),
      tribesFormed:       this._tribesFormed,
      settlementsBuilt:   this.settlements.getCount(),
      techDiscovered:     this._techDiscovered,
      highestPopulation:  this._highestPop,
      recentEvents:       this.events.getRecentHistory(8),
      stageName:          this.stages.current.name,
      stageProgress:      this.stages.progress,
      favor:              Math.floor(this.godPowers.favor),
      typeDistribution:   this.entities.getTypeDistribution(),
      settlementLevels:   this.settlements.getLevelDistribution(),
    };
  }

  get year(): number { return this._year; }
}
