// ============================================================
// SIMULATION — master controller
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { SettlementManager, Settlement } from '../entities/SettlementManager';
import { SIM } from '../config/constants';

export interface SimulationState {
  tick:               number;
  year:               number;
  population:         number;
  totalBirths:        number;
  totalDeaths:        number;
  resourcesExtracted: number;
  settlementsBuilt:   number;
  highestPopulation:  number;
  typeDistribution:   Record<string, number>;
  settlementLevels:   Record<string, number>;
  activityLog:        string[];
}

export class Simulation {
  readonly world:       World;
  readonly settlements: SettlementManager;
  readonly entities:    EntityManager;

  private _tick         = 0;
  private _year         = 0;
  private _highestPop   = 0;
  private _activityLog: string[] = [];

  /** Called when a settlement is dynamically founded. */
  onSettlementFounded?: (s: Settlement) => void;
  /** Called when a settlement levels up. */
  onSettlementLevelUp?: (s: Settlement) => void;

  constructor(_seed?: number) {
    this.world       = new World(_seed);
    this.settlements = new SettlementManager(this.world);
    this.entities    = new EntityManager(this.world, this.settlements);

    this.entities.spawnAtRandom('wanderer', 40);
  }

  tick(): void {
    this._tick++;

    this.world.tick();

    // Dynamic settlement formation — runs every N ticks
    if (this._tick % SIM.CLUSTER_CHECK_INTERVAL === 0) {
      const formed = this.settlements.checkForNewSettlements(this.entities.getAlive());
      for (const s of formed) {
        const msg = `${s.name} founded — ${s.population} people settled together.`;
        this._pushLog(msg);
        this.onSettlementFounded?.(s);
      }
    }

    this.settlements.tick(this.entities.getAlive());

    // Check for level-ups that happened this tick
    for (const s of this.settlements.getAll()) {
      if (s.justLeveledUp) {
        const msg = `${s.name} grew into a ${s.level === 2 ? 'Hamlet' : 'Village'}!`;
        this._pushLog(msg);
        this.onSettlementLevelUp?.(s);
      }
    }

    this.entities.tick(this._tick);

    const pop = this.entities.getCount();
    if (pop > this._highestPop) this._highestPop = pop;

    if (this._tick % SIM.TICKS_PER_YEAR === 0) {
      this._year++;
      this._yearlyLogic();
    }
  }

  private _yearlyLogic(): void {
    // Safety net respawn
    if (this.entities.getCount() < 6) {
      this.entities.spawnAtRandom('wanderer', 8);
      this._pushLog('Wanderers arrive from distant lands.');
    }
  }

  private _pushLog(msg: string): void {
    this._activityLog.push(`[${this._year}] ${msg}`);
    if (this._activityLog.length > 30) this._activityLog.shift();
  }

  getState(): SimulationState {
    return {
      tick:               this._tick,
      year:               this._year,
      population:         this.entities.getCount(),
      totalBirths:        this.entities.totalBirths,
      totalDeaths:        this.entities.totalDeaths,
      resourcesExtracted: Math.floor(this.entities.resourcesExtracted),
      settlementsBuilt:   this.settlements.getCount(),
      highestPopulation:  this._highestPop,
      typeDistribution:   this.entities.getTypeDistribution(),
      settlementLevels:   this.settlements.getLevelDistribution(),
      activityLog:        [...this._activityLog].reverse().slice(0, 12),
    };
  }

  get year(): number { return this._year; }
}
