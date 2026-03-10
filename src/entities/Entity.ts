// ============================================================
// ENTITY — core data types for sentient civilization units.
// All entities begin as hunter_gatherers and specialize over time.
// ============================================================

import { ENTITY } from '../config/constants';

export type EntityType =
  | 'hunter_gatherer'  // Starting type: hunts/gathers, forms tribes
  | 'villager'         // Settled: generalist, farms, basic labor
  | 'farmer'           // Food specialist: works farm tiles
  | 'craftsman'        // Resource specialist: mines, builds
  | 'warrior'          // Combat: defends settlements, raids
  | 'merchant'         // Trade: moves resources between settlements
  | 'scholar'          // Research: generates tech points
  | 'noble';           // Governance: boosts settlement level

export interface Genes {
  strength:     number;  // 0–1  hunting, combat, manual labor
  intelligence: number;  // 0–1  path-finding quality, tech discovery rate
  sociability:  number;  // 0–1  tribe bonding, trade bonus
  resilience:   number;  // 0–1  disease/starvation resistance
  creativity:   number;  // 0–1  crafting output, scholar bonus
  ambition:     number;  // 0–1  settlement founding, specialization drive
}

export interface EntityState {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  energy: number;             // 0–1 (starvation at 0)
  age: number;
  maxAge: number;
  genes: Genes;
  tribeId: number;            // -1 = solitary
  settlementId: number;       // -1 = no home settlement
  alive: boolean;
  reproductionCooldown: number;
  memory: EntityMemory;
  carryingFood: number;
  carryingResource: number;
  carryingResourceType: 'stone' | 'wood' | 'iron' | null;
}

export interface EntityMemory {
  lastFoodTile:     [number, number] | null;
  homeSettlement:   [number, number] | null;
  target:           [number, number] | null;
  returning:        boolean;
  ticksSinceFood:   number;
}

let _nextId = 1;
export function nextEntityId(): number { return _nextId++; }

export function createGenes(parent1?: Genes, parent2?: Genes): Genes {
  const base: Genes = {
    strength:     0.4 + (Math.random() - 0.5) * 0.2,
    intelligence: 0.3 + (Math.random() - 0.5) * 0.2,
    sociability:  0.5 + (Math.random() - 0.5) * 0.2,
    resilience:   0.5 + (Math.random() - 0.5) * 0.2,
    creativity:   0.3 + (Math.random() - 0.5) * 0.2,
    ambition:     0.2 + (Math.random() - 0.5) * 0.2,
  };

  if (!parent1) return base;

  const p2 = parent2 ?? parent1;
  const inherit = (a: number, b: number): number => {
    const mid = (a + b) / 2;
    const mutation = (Math.random() - 0.5) * 2 * ENTITY.MUTATION_RATE;
    return Math.max(0, Math.min(1, mid + mutation));
  };

  return {
    strength:     inherit(parent1.strength,     p2.strength),
    intelligence: inherit(parent1.intelligence, p2.intelligence),
    sociability:  inherit(parent1.sociability,  p2.sociability),
    resilience:   inherit(parent1.resilience,   p2.resilience),
    creativity:   inherit(parent1.creativity,   p2.creativity),
    ambition:     inherit(parent1.ambition,     p2.ambition),
  };
}

export function createEntity(
  type: EntityType,
  x: number, y: number,
  genes?: Genes,
  tribeId: number = -1,
): EntityState {
  const g = genes ?? createGenes();
  return {
    id: nextEntityId(),
    type,
    x, y,
    energy: 0.8 + Math.random() * 0.2,
    age: 0,
    maxAge: (40 + Math.random() * 40) * (1 + g.resilience * 0.5),
    genes: g,
    tribeId,
    settlementId: -1,
    alive: true,
    reproductionCooldown: Math.floor(Math.random() * ENTITY.REPRO_COOLDOWN_TICKS),
    memory: {
      lastFoodTile:   null,
      homeSettlement: null,
      target:         null,
      returning:      false,
      ticksSinceFood: 0,
    },
    carryingFood: 0,
    carryingResource: 0,
    carryingResourceType: null,
  };
}
