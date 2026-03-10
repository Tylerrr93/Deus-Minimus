// ============================================================
// SETTLEMENT MANAGER
// Manages the hub network of civilization.
// Settlements are physical locations where units live, deposit
// food, craft goods, and from which they set out to work.
// ============================================================

import { World } from '../world/World';
import { TILE_PASSABLE } from '../world/Tile';

export type SettlementLevel = 1 | 2 | 3 | 4;
export const SETTLEMENT_LEVEL_NAMES: Record<SettlementLevel, string> = {
  1: 'Camp',
  2: 'Village',
  3: 'Town',
  4: 'City',
};

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  tribeId: number;
  level: SettlementLevel;
  population: number;
  foodStorage: number;
  maxFoodStorage: number;
  woodStorage: number;
  stoneStorage: number;
  ironStorage: number;
  age: number;          // ticks since founded
  roads: number[];      // connected settlement IDs
  techPoints: number;   // accumulated research
}

const SETTLEMENT_NAMES = [
  'Ashenvale', 'Dunmark', 'Ironholt', 'Goldenfield', 'Westmere',
  'Stonegate', 'Oakhaven', 'Dawnkeep', 'Thornwall', 'Brightwater',
  'Crowspire', 'Emberveil', 'Greyhaven', 'Moorfield', 'Salthollow',
  'Crestfall', 'Deepmoor', 'Frostpeak', 'Grimhold', 'Halloway',
  'Ironwood', 'Jadepond', 'Kingsbluff', 'Lochdale', 'Mirepoint',
  'Northfen', 'Oldstoke', 'Pinewood', 'Quarryham', 'Ravenmoor',
  'Silverhill', 'Timberveil', 'Underholt', 'Verdant', 'Whitemarsh',
];

let _nameIdx = 0;
let _nextSettlementId = 1;

// Minimum tile-distance between any two settlements
const MIN_SETTLEMENT_DISTANCE = 18;
// How much food is consumed per population tick
const FOOD_PER_POP_TICK = 0.002;

export class SettlementManager {
  private settlements: Map<number, Settlement> = new Map();

  constructor(private readonly world: World) {}

  /** Attempt to found a new settlement at (x,y). Returns null if position is invalid. */
  found(x: number, y: number, tribeId: number): Settlement | null {
    const tile = this.world.getTile(x, y);
    if (!tile || !TILE_PASSABLE[tile.type]) return null;

    // Enforce minimum distance
    for (const s of this.settlements.values()) {
      const dist = Math.abs(s.x - x) + Math.abs(s.y - y);
      if (dist < MIN_SETTLEMENT_DISTANCE) return null;
    }

    const settlement: Settlement = {
      id: _nextSettlementId++,
      name: SETTLEMENT_NAMES[_nameIdx++ % SETTLEMENT_NAMES.length],
      x, y,
      tribeId,
      level: 1,
      population: 0,
      foodStorage: 8,
      maxFoodStorage: 30,
      woodStorage: 0,
      stoneStorage: 0,
      ironStorage: 0,
      age: 0,
      roads: [],
      techPoints: 0,
    };

    this.settlements.set(settlement.id, settlement);

    // Mark the tile
    const t = this.world.getTile(x, y);
    if (t) t.improvement = 'settlement';

    return settlement;
  }

  tick(hasMechanic: (m: string) => boolean): void {
    for (const s of this.settlements.values()) {
      s.age++;

      // Population-driven food consumption
      const consumed = s.population * FOOD_PER_POP_TICK;
      s.foodStorage = Math.max(0, s.foodStorage - consumed);

      // Level progression based on population
      const newLevel = s.population >= 40 ? 4
        : s.population >= 15 ? 3
        : s.population >= 5  ? 2
        : 1;
      if (newLevel !== s.level) {
        s.level = newLevel as SettlementLevel;
        s.maxFoodStorage = 30 * s.level;
        // Upgrade the tile visually on level-up
        const t = this.world.getTile(s.x, s.y);
        if (t) t.improvement = 'settlement';
      }

      // Road building: connect to nearest settlement once roads unlock
      if (hasMechanic('roads') && s.level >= 2 && Math.random() < 0.0005) {
        this.buildRoadToNearest(s);
      }

      // Scholars and scribes generate tech points
      if (hasMechanic('writing')) {
        s.techPoints += 0.005 * s.level;
      }
    }
  }

  private buildRoadToNearest(s: Settlement): void {
    let nearest: Settlement | null = null;
    let nearestDist = Infinity;
    for (const other of this.settlements.values()) {
      if (other.id === s.id || s.roads.includes(other.id)) continue;
      const dist = Math.abs(other.x - s.x) + Math.abs(other.y - s.y);
      if (dist < nearestDist) { nearestDist = dist; nearest = other; }
    }
    if (!nearest || nearestDist > 80) return;

    this.drawRoadLine(s.x, s.y, nearest.x, nearest.y);
    s.roads.push(nearest.id);
    nearest.roads.push(s.id);
  }

  /** Bresenham-style road between two settlements */
  private drawRoadLine(x1: number, y1: number, x2: number, y2: number): void {
    let x = x1, y = y1;
    let steps = 0;
    while ((x !== x2 || y !== y2) && steps++ < 300) {
      const dx = Math.sign(x2 - x);
      const dy = Math.sign(y2 - y);
      // Prefer horizontal movement to create more natural-looking roads
      if (Math.abs(x2 - x) >= Math.abs(y2 - y)) x += dx;
      else y += dy;
      const tile = this.world.getTile(x, y);
      if (tile && TILE_PASSABLE[tile.type] && tile.improvement !== 'settlement') {
        tile.improvement = 'road';
      }
    }
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
    s[`${type}Storage`] = Math.min(100, (s[`${type}Storage`] as number) + amount);
  }

  // ── Queries ──────────────────────────────────────────────

  getAll(): Settlement[] {
    return [...this.settlements.values()];
  }

  getById(id: number): Settlement | null {
    return this.settlements.get(id) ?? null;
  }

  getCount(): number {
    return this.settlements.size;
  }

  getNearestTo(x: number, y: number, tribeId: number = -1): Settlement | null {
    let nearest: Settlement | null = null;
    let nearestDist = Infinity;
    for (const s of this.settlements.values()) {
      if (tribeId !== -1 && s.tribeId !== tribeId) continue;
      const dist = Math.abs(s.x - x) + Math.abs(s.y - y);
      if (dist < nearestDist) { nearestDist = dist; nearest = s; }
    }
    return nearest;
  }

  getTotalTechPoints(): number {
    let total = 0;
    for (const s of this.settlements.values()) total += s.techPoints;
    return total;
  }

  getLevelDistribution(): Record<string, number> {
    const dist: Record<string, number> = { camp: 0, village: 0, town: 0, city: 0 };
    for (const s of this.settlements.values()) {
      if (s.level === 1) dist.camp++;
      else if (s.level === 2) dist.village++;
      else if (s.level === 3) dist.town++;
      else dist.city++;
    }
    return dist;
  }
}
