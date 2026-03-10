import { GOD_POWERS, GodPower } from './godPowerDefinitions';
import { GOD } from '../config/constants';
import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { SettlementManager } from '../entities/SettlementManager';
import { SimStats } from '../stages/stageDefinitions';

export class GodPowerManager {
  private _favor: number;
  private cooldowns: Map<string, number> = new Map();
  private log: Array<{ year: number; message: string }> = [];

  constructor(private hasMechanic: (name: string) => boolean) {
    this._favor = GOD.INITIAL_FAVOR;
  }

  tick(): void {
    this._favor = Math.min(GOD.MAX_FAVOR, this._favor + GOD.FAVOR_REGEN_PER_TICK);
  }

  get favor(): number { return this._favor; }

  getAvailablePowers(year: number): GodPower[] {
    return GOD_POWERS.filter(p => {
      if (p.requiredMechanic && !this.hasMechanic(p.requiredMechanic)) return false;
      const lastUsed = this.cooldowns.get(p.id) ?? -Infinity;
      if (year - lastUsed < p.cooldownYears) return false;
      return true;
    });
  }

  canAfford(powerId: string): boolean {
    const power = GOD_POWERS.find(p => p.id === powerId);
    return power ? this._favor >= power.favorCost : false;
  }

  execute(
    powerId: string,
    year: number,
    world: World,
    em: EntityManager,
    settlements: SettlementManager,
    stats: SimStats,
    target?: { x: number; y: number }
  ): string | null {
    const power = GOD_POWERS.find(p => p.id === powerId);
    if (!power) return null;
    if (this._favor < power.favorCost) return `Not enough favor. Need ${power.favorCost}.`;
    const lastUsed = this.cooldowns.get(power.id) ?? -Infinity;
    if (year - lastUsed < power.cooldownYears) {
      return `${power.name} is on cooldown for ${power.cooldownYears - (year - lastUsed)} more years.`;
    }

    this._favor -= power.favorCost;
    this.cooldowns.set(power.id, year);
    const message = power.execute(world, em, settlements, stats, target);
    this.log.push({ year, message: `${power.icon} ${power.name}: ${message}` });
    return message;
  }

  addFavor(amount: number): void {
    this._favor = Math.min(GOD.MAX_FAVOR, this._favor + amount);
  }

  getLog(): Array<{ year: number; message: string }> {
    return [...this.log].reverse();
  }
}
