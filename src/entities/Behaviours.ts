// ============================================================
// BEHAVIOURS — discrete behaviour units for civilization entities.
// Each function is pure: reads context, returns a result delta.
// StageManager gates which behaviours are active via hasMechanic().
// ============================================================

import { EntityState, EntityType } from './Entity';
import { World } from '../world/World';
import { TILE_FOOD_VALUE, TILE_PASSABLE } from '../world/Tile';
import { ENTITY } from '../config/constants';
import { SettlementManager } from './SettlementManager';

export interface BehaviourContext {
  entity: EntityState;
  world: World;
  neighbours: EntityState[];   // pre-filtered via spatial grid — already cheap
  tick: number;
  hasMechanic: (name: string) => boolean;
  settlements: SettlementManager;
}

export type BehaviourResult = {
  dx?: number;
  dy?: number;
  eat?: number;                             // direct energy restore from tile
  reproduce?: boolean;
  die?: boolean;
  extractResource?: { type: string; amount: number };
  depositFood?: number;                     // carrying food amount to deposit
  depositResource?: { type: 'stone' | 'wood' | 'iron'; amount: number };
  researchTick?: number;                    // tech point contribution
};

// ── Movement helpers ─────────────────────────────────────────

function randomMove(): { dx: number; dy: number } {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  const d = dirs[Math.floor(Math.random() * dirs.length)];
  return { dx: d[0], dy: d[1] };
}

function moveToward(ex: number, ey: number, tx: number, ty: number): { dx: number; dy: number } {
  const dx = Math.sign(tx - ex);
  const dy = Math.sign(ty - ey);
  return { dx, dy };
}

// ── Shared core behaviours ───────────────────────────────────

export function behaviourAge(ctx: BehaviourContext): BehaviourResult {
  ctx.entity.age++;
  if (ctx.entity.age >= ctx.entity.maxAge) return { die: true };
  return {};
}

/** Energy drain per tick. Resilience reduces the rate. */
export function behaviourHunger(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  const rate = ENTITY.HUNGER_RATE * (1 - entity.genes.resilience * 0.3);
  entity.energy -= rate;

  // Before starvation, try to eat from home settlement storage
  if (entity.energy < 0.35 && entity.settlementId !== -1) {
    const s = ctx.settlements.getById(entity.settlementId);
    if (s && s.foodStorage > 0.5) {
      const withdrawn = ctx.settlements.withdrawFood(s.id, 0.4);
      entity.energy = Math.min(1, entity.energy + withdrawn * 0.5);
    }
  }

  if (entity.energy <= 0) return { die: true };
  return {};
}

export function behaviourReproduce(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('reproduction')) return {};
  const { entity } = ctx;
  if (entity.reproductionCooldown > 0) { entity.reproductionCooldown--; return {}; }
  if (entity.energy < ENTITY.REPRO_ENERGY_THRESHOLD) return {};

  const mate = ctx.neighbours.find(n =>
    n.alive && n.type === entity.type &&
    n.tribeId === entity.tribeId &&
    n.reproductionCooldown === 0 &&
    n.energy > ENTITY.REPRO_ENERGY_THRESHOLD
  );

  if (mate || entity.genes.sociability > 0.85) {
    entity.reproductionCooldown = ENTITY.REPRO_COOLDOWN_TICKS;
    entity.energy *= 0.65;
    return { reproduce: true };
  }
  return {};
}

// ── Hunter-Gatherer behaviours ───────────────────────────────

/**
 * Core gather loop: go out to food tiles, fill carry capacity, return to settlement.
 * Without a settlement, eat in-place.
 */
export function behaviourGather(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, settlements } = ctx;

  // ── Returning phase: head home to deposit ────────────────
  if (entity.memory.returning && entity.settlementId !== -1) {
    const s = settlements.getById(entity.settlementId);
    if (!s) { entity.memory.returning = false; return {}; }

    const dist = Math.abs(s.x - entity.x) + Math.abs(s.y - entity.y);
    if (dist <= 1) {
      // Arrived at settlement — deposit
      entity.memory.returning = false;
      const deposited = entity.carryingFood;
      entity.carryingFood = 0;
      return { depositFood: deposited };
    }
    return moveToward(entity.x, entity.y, s.x, s.y);
  }

  // ── Eat in-place if starving and no settlement ────────────
  if (entity.energy < 0.4 && entity.settlementId === -1) {
    const tile = world.getTile(entity.x, entity.y);
    if (tile) {
      const food = tile.resources.find(r => r.type === 'food' && r.amount > 0);
      if (food) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.3);
        entity.memory.ticksSinceFood = 0;
        return { eat: extracted };
      }
    }
  }

  // ── Gathering phase ───────────────────────────────────────
  if (entity.energy > 0.5) {
    // Scan for food with intelligence-based range
    const range = Math.ceil(3 + entity.genes.intelligence * 5);
    let bestTile = null, bestScore = -1;

    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const t = world.getTile(entity.x + dx, entity.y + dy);
        if (!t || !TILE_PASSABLE[t.type]) continue;
        const food = t.resources.find(r => r.type === 'food' && r.amount > 0.3);
        if (food) {
          const score = food.amount / (Math.abs(dx) + Math.abs(dy) + 1);
          if (score > bestScore) { bestScore = score; bestTile = t; }
        }
      }
    }

    if (bestTile) {
      entity.memory.lastFoodTile = [bestTile.x, bestTile.y];
      // If standing on food, extract and carry
      if (bestTile.x === entity.x && bestTile.y === entity.y) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.5);
        if (extracted > 0) {
          entity.carryingFood += extracted;
          entity.memory.ticksSinceFood = 0;
          // If carrying enough, head home
          if (entity.carryingFood >= ENTITY.CARRY_CAPACITY * 0.8 && entity.settlementId !== -1) {
            entity.memory.returning = true;
          }
        }
        return {};
      }
      return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
    }

    // Use remembered food location
    if (entity.memory.lastFoodTile) {
      const [fx, fy] = entity.memory.lastFoodTile;
      if (Math.abs(fx - entity.x) + Math.abs(fy - entity.y) < 2) {
        entity.memory.lastFoodTile = null;
      } else {
        return moveToward(entity.x, entity.y, fx, fy);
      }
    }

    // Drift toward fertile terrain
    const tile = world.getTile(entity.x, entity.y);
    const fv = TILE_FOOD_VALUE[tile?.type ?? 'plains'];
    if (fv < 0.3) return randomMove();
  }

  // Low energy + no food nearby — wander
  entity.memory.ticksSinceFood++;
  if (entity.memory.ticksSinceFood > 80) return randomMove();
  return {};
}

/** Hunter: actively pursues prey (other species from a separate pool are gone,
 *  so "hunting" means finding the richest food tile in an extended radius). */
export function behaviourHunt(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('hunting')) return {};
  const { entity, world } = ctx;
  if (entity.energy > 0.6) return {};

  const range = Math.ceil(4 + entity.genes.strength * 4);
  let bestTile = null, bestScore = -1;

  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (!t || !TILE_PASSABLE[t.type]) continue;
      const food = t.resources.find(r => r.type === 'food' && r.amount > 0.5);
      if (food) {
        const score = food.amount * (1 + entity.genes.strength) / (Math.abs(dx) + Math.abs(dy) + 1);
        if (score > bestScore) { bestScore = score; bestTile = t; }
      }
    }
  }
  if (!bestTile) return {};
  if (bestTile.x === entity.x && bestTile.y === entity.y) {
    const extracted = world.extractResource(entity.x, entity.y, 'food', 0.4 + entity.genes.strength * 0.3);
    entity.carryingFood += extracted;
    return {};
  }
  return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
}

/** Stay near home settlement; wander within a radius. */
export function behaviourTerritorialWander(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  if (entity.memory.returning) return {};

  if (entity.memory.homeSettlement) {
    const [hx, hy] = entity.memory.homeSettlement;
    const dist = Math.abs(hx - entity.x) + Math.abs(hy - entity.y);
    if (dist > 20 && Math.random() < 0.3) {
      return moveToward(entity.x, entity.y, hx, hy);
    }
  }

  if (Math.random() < 0.4) return randomMove();
  return {};
}

// ── Villager / Farmer behaviours ─────────────────────────────

/** Farmers improve plains tiles into farms and produce extra food. */
export function behaviourFarm(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('farming')) return {};
  const { entity, world } = ctx;
  if (entity.type !== 'farmer' && entity.type !== 'villager') return {};

  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};

  // Improve an adjacent plains tile into a farm
  if (tile.type === 'plains' && !tile.improvement && Math.random() < 0.002) {
    tile.improvement = 'farm';
    // Farms have higher food regen
    const food = tile.resources.find(r => r.type === 'food');
    if (food) food.regenRate *= 2.5;
    return {};
  }

  // Harvest from a farm
  if (tile.improvement === 'farm') {
    const extracted = world.extractResource(entity.x, entity.y, 'food', 0.6);
    if (extracted > 0) {
      entity.carryingFood += extracted;
      if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
        entity.memory.returning = true;
      }
    }
    return {};
  }

  // Walk to nearest farm or plains
  const range = 6;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (t && (t.improvement === 'farm' || t.type === 'plains') && TILE_PASSABLE[t.type]) {
        return moveToward(entity.x, entity.y, t.x, t.y);
      }
    }
  }
  return {};
}

// ── Craftsman behaviours ─────────────────────────────────────

export function behaviourMine(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('basic_tools')) return {};
  const { entity, world } = ctx;
  if (entity.type !== 'craftsman') return {};

  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};

  for (const resType of ['stone', 'wood', 'iron'] as const) {
    const res = tile.resources.find(r => r.type === resType && r.amount > 0);
    if (res && Math.random() < 0.05) {
      const extracted = world.extractResource(entity.x, entity.y, resType, 0.5);
      if (extracted > 0) {
        entity.carryingResource += extracted;
        entity.carryingResourceType = resType;
        if (entity.carryingResource >= ENTITY.CARRY_CAPACITY * 0.8 && entity.settlementId !== -1) {
          entity.memory.returning = true;
        }
        return { extractResource: { type: resType, amount: extracted } };
      }
    }
  }

  // Walk toward resource-bearing tile
  const range = 8;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (!t || !TILE_PASSABLE[t.type]) continue;
      if (t.resources.some(r => ['stone', 'wood', 'iron'].includes(r.type) && r.amount > 1)) {
        return moveToward(entity.x, entity.y, t.x, t.y);
      }
    }
  }
  return {};
}

/** Craftsman deposits resources on return to settlement. */
export function behaviourReturnResources(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (!entity.memory.returning || entity.carryingResource <= 0) return {};
  if (entity.settlementId === -1) return {};

  const s = settlements.getById(entity.settlementId);
  if (!s) { entity.memory.returning = false; return {}; }

  const dist = Math.abs(s.x - entity.x) + Math.abs(s.y - entity.y);
  if (dist <= 1) {
    if (entity.carryingResourceType) {
      settlements.depositResource(s.id, entity.carryingResourceType, entity.carryingResource);
    }
    entity.carryingResource = 0;
    entity.carryingResourceType = null;
    entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, s.x, s.y);
}

// ── Merchant behaviours ──────────────────────────────────────

export function behaviourTrade(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('trade')) return {};
  const { entity, settlements } = ctx;
  if (entity.type !== 'merchant') return {};

  // Merchants ferry food from surplus settlements to deficit ones
  const home = settlements.getById(entity.settlementId);
  if (!home) return {};

  if (!entity.memory.returning) {
    // Pick up surplus food from home
    if (home.foodStorage > home.maxFoodStorage * 0.6 && entity.carryingFood < ENTITY.CARRY_CAPACITY) {
      const taken = settlements.withdrawFood(home.id, ENTITY.CARRY_CAPACITY);
      entity.carryingFood += taken;
      if (entity.carryingFood > 0) entity.memory.returning = true; // "returning" repurposed as "heading to trade dest"
    }
    return {};
  }

  // Find a settlement in need
  const all = settlements.getAll();
  const deficit = all.find(s =>
    s.id !== home.id &&
    s.foodStorage < s.maxFoodStorage * 0.3
  );
  if (!deficit) { entity.memory.returning = false; return {}; }

  const dist = Math.abs(deficit.x - entity.x) + Math.abs(deficit.y - entity.y);
  if (dist <= 1) {
    settlements.depositFood(deficit.id, entity.carryingFood);
    entity.carryingFood = 0;
    entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, deficit.x, deficit.y);
}

// ── Scholar behaviour ────────────────────────────────────────

export function behaviourResearch(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('writing')) return {};
  const { entity } = ctx;
  if (entity.type !== 'scholar') return {};
  // Stay near settlement; emit research ticks passively
  return { researchTick: 0.02 + entity.genes.creativity * 0.05 };
}

// ── Warrior behaviour ────────────────────────────────────────

export function behaviourPatrol(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('warfare')) return {};
  const { entity } = ctx;
  if (entity.type !== 'warrior') return {};

  if (entity.memory.homeSettlement && Math.random() < 0.05) {
    const [hx, hy] = entity.memory.homeSettlement;
    const dist = Math.abs(hx - entity.x) + Math.abs(hy - entity.y);
    if (dist > 12) return moveToward(entity.x, entity.y, hx, hy);
  }
  if (Math.random() < 0.3) return randomMove();
  return {};
}

// ── Noble behaviour ──────────────────────────────────────────

export function behaviourAdminister(ctx: BehaviourContext): BehaviourResult {
  if (!ctx.hasMechanic('settlements')) return {};
  const { entity, settlements } = ctx;
  if (entity.type !== 'noble') return {};

  // Nobles stay at their settlement and passively boost it
  if (entity.settlementId !== -1) {
    const s = settlements.getById(entity.settlementId);
    if (s) {
      s.techPoints += 0.001; // administrative knowledge
    }
  }
  if (Math.random() < 0.1) return randomMove(); // small wander
  return {};
}

// ── Behaviour pipeline registry ──────────────────────────────

export type BehaviourFn = (ctx: BehaviourContext) => BehaviourResult;

export const BEHAVIOUR_PIPELINES: Record<EntityType, BehaviourFn[]> = {
  hunter_gatherer: [
    behaviourAge, behaviourHunger, behaviourHunt,
    behaviourGather, behaviourReproduce, behaviourTerritorialWander,
  ],
  villager: [
    behaviourAge, behaviourHunger, behaviourFarm,
    behaviourGather, behaviourReproduce, behaviourTerritorialWander,
  ],
  farmer: [
    behaviourAge, behaviourHunger, behaviourFarm,
    behaviourReproduce, behaviourTerritorialWander,
  ],
  craftsman: [
    behaviourAge, behaviourHunger, behaviourMine,
    behaviourReturnResources, behaviourReproduce, behaviourTerritorialWander,
  ],
  warrior: [
    behaviourAge, behaviourHunger,
    behaviourPatrol, behaviourReproduce,
  ],
  merchant: [
    behaviourAge, behaviourHunger,
    behaviourTrade, behaviourReproduce, behaviourTerritorialWander,
  ],
  scholar: [
    behaviourAge, behaviourHunger,
    behaviourResearch, behaviourReproduce, behaviourTerritorialWander,
  ],
  noble: [
    behaviourAge, behaviourHunger,
    behaviourAdminister, behaviourReproduce,
  ],
};
