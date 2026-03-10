import { GAME_EVENTS, GameEvent } from './eventDefinitions';
import { SimStats } from '../stages/stageDefinitions';
import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';

export interface FiredEvent {
  year: number;
  event: GameEvent;
  message: string;
}

export class EventManager {
  private lastFired: Map<string, number> = new Map();
  private history: FiredEvent[] = [];

  constructor(private hasMechanic: (name: string) => boolean) {}

  tick(year: number, stats: SimStats, world: World, em: EntityManager): FiredEvent | null {
    for (const ev of GAME_EVENTS) {
      if (ev.requiredMechanic && !this.hasMechanic(ev.requiredMechanic)) continue;
      const last = this.lastFired.get(ev.id) ?? -Infinity;
      if (year - last < ev.cooldownYears) continue;
      if (ev.condition && !ev.condition(stats)) continue;
      if (Math.random() > ev.probability) continue;

      const message = ev.effect(world, em, stats);
      const fired: FiredEvent = { year, event: ev, message };
      this.history.push(fired);
      this.lastFired.set(ev.id, year);
      return fired;
    }
    return null;
  }

  getHistory(): FiredEvent[] { return [...this.history].reverse(); }

  getRecentHistory(count: number): FiredEvent[] {
    return this.history.slice(-count).reverse();
  }
}
