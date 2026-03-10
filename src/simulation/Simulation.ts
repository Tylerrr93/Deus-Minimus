// ============================================================
// SIMULATION — master controller.
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { SettlementManager } from '../entities/SettlementManager';
import { StageManager } from '../stages/StageManager';
import { StageDefinition } from '../stages/stageDefinitions';
import { EventManager, FiredEvent } from '../events/EventManager';
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
  highestPopulation:  number;
  recentEvents:       FiredEvent[];
  stageName:          string;
  stageProgress:      number;
  typeDistribution:   Record<string, number>;
  settlementLevels:   Record<string, number>;
}

let _nextTribeId = 1;

export class Simulation {
  readonly world:       World;
  readonly settlements: SettlementManager;
  readonly entities:    EntityManager;
  readonly stages:      StageManager;
  readonly events:      EventManager;

  private _tick         = 0;
  private _year         = 0;
  private _highestPop   = 0;
  private _tribesFormed = 0;

  onStageTransition?: (prev: StageDefinition, next: StageDefinition) => void;
  onEvent?: (event: FiredEvent) => void;

  constructor(_seed?: number) {
    this.world = new World(_seed);

    this.stages = new StageManager((prev, next) => {
      this.onStageTransition?.(prev, next);
    });

    this.settlements = new SettlementManager(this.world);

    this.entities = new EntityManager(this.world, this.settlements);

    this.events = new EventManager((mech) => this.stages.hasMechanic(mech));

    this.entities.spawnAtRandom('hunter_gatherer', 40);
  }

  tick(): void {
    this._tick++;
    this.world.tick();
    this.settlements.tick((_m) => true);  // all mechanics always available now
    this.entities.tick(this._tick);

    const pop = this.entities.getCount();
    if (pop > this._highestPop) this._highestPop = pop;

    if (this._tick % SIM.TICKS_PER_YEAR === 0) {
      this._year++;
      this.stages.checkTransition(this.buildStats(), this.world, this.entities, this.settlements);
      this.yearlyLogic();
      const ev = this.events.tick(this._year, this.buildStats(), this.world, this.entities);
      if (ev) this.onEvent?.(ev);
    }
  }

  private yearlyLogic(): void {
    // Safety net: if population collapses, seed a few new arrivals
    if (this.entities.getCount() < 6) {
      this.entities.spawnAtRandom('hunter_gatherer', 8);
    }

    // Tribe formation — every 2 years
    if (this._year % 2 === 0) this.tryFormTribes();

    // Tribe count stat
    const tribeIds = new Set(
      this.entities.getAlive().map(e => e.tribeId).filter(id => id !== -1)
    );
    this._tribesFormed = tribeIds.size;
  }

  private tryFormTribes(): void {
    const ungrouped = this.entities.getAlive().filter(e =>
      e.tribeId === -1 && e.type === 'hunter_gatherer' && !e.isChild
    );

    for (const leader of ungrouped) {
      if (leader.tribeId !== -1) continue;
      if (leader.genes.sociability < 0.35) continue;

      const nearby = this.entities.getAlive().filter(e =>
        e.tribeId === -1 && !e.isChild &&
        Math.abs(e.x - leader.x) <= ENTITY.TRIBE_BOND_RADIUS &&
        Math.abs(e.y - leader.y) <= ENTITY.TRIBE_BOND_RADIUS
      );

      if (nearby.length >= 2) {
        const newTribeId = _nextTribeId++;
        for (const member of [leader, ...nearby.slice(0, 7)]) {
          member.tribeId = newTribeId;
        }
      }
    }
  }

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
      techDiscovered:     0,
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
      highestPopulation:  this._highestPop,
      recentEvents:       this.events.getRecentHistory(8),
      stageName:          this.stages.current.name,
      stageProgress:      this.stages.progress,
      typeDistribution:   this.entities.getTypeDistribution(),
      settlementLevels:   this.settlements.getLevelDistribution(),
    };
  }

  get year(): number { return this._year; }
}
