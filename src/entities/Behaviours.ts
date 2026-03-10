// ============================================================
// BEHAVIOURS — discrete behaviour functions for entities.
// ============================================================

import {
  EntityState, EntityType, isAttractedTo, canReproduce,
  rollOrientation, rollRelationshipStyle,
} from './Entity';
import { World } from '../world/World';
import { TILE_FOOD_VALUE, TILE_PASSABLE } from '../world/Tile';
import { ENTITY, SETTLEMENT } from '../config/constants';
import { SettlementManager } from './SettlementManager';

export interface BehaviourContext {
  entity:      EntityState;
  world:       World;
  neighbours:  EntityState[];
  allEntities: Map<number, EntityState>;
  tick:        number;
  settlements: SettlementManager;
}

export type BehaviourResult = {
  dx?:              number;
  dy?:              number;
  eat?:             number;
  reproduce?:       boolean;
  reproduceWith?:   number;
  die?:             boolean;
  extractResource?: { type: string; amount: number };
  depositFood?:     number;
  depositResource?: { type: 'stone' | 'wood' | 'iron'; amount: number };
  workOnProject?:   { projectId: number; tileX: number; tileY: number };
};

// ── Movement helpers ──────────────────────────────────────────

function randomMove(): { dx: number; dy: number } {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  const d = dirs[Math.floor(Math.random() * dirs.length)];
  return { dx: d[0], dy: d[1] };
}

function moveToward(ex: number, ey: number, tx: number, ty: number): { dx: number; dy: number } {
  return { dx: Math.sign(tx - ex), dy: Math.sign(ty - ey) };
}

function taxiDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// ── Core ──────────────────────────────────────────────────────

export function behaviourAge(ctx: BehaviourContext): BehaviourResult {
  ctx.entity.age++;
  if (ctx.entity.age >= ctx.entity.maxAge) return { die: true };
  return {};
}

export function behaviourAnimTick(ctx: BehaviourContext): BehaviourResult {
  const a = ctx.entity.actionAnim;
  if (a.type !== null) {
    a.progress = (a.progress + 1) % 8;
    if (a.progress === 0) a.type = null;
  }
  return {};
}

export function behaviourGrow(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, allEntities } = ctx;
  if (!entity.isChild) return {};

  // Children can eat from their current tile so they don't silently starve
  const tile = world.getTile(entity.x, entity.y);
  if (tile && entity.energy < 0.6) {
    const food = tile.resources.find(r => r.type === 'food' && r.amount > 0.1);
    if (food) {
      const got = world.extractResource(entity.x, entity.y, 'food', 0.2);
      entity.energy = Math.min(1, entity.energy + got * 0.5);
    }
  }

  // Pull from settlement food when available
  if (entity.energy < 0.5 && entity.settlementId !== -1) {
    const s = ctx.settlements.getById(entity.settlementId);
    if (s && s.foodStorage > 0.3) {
      const got = ctx.settlements.withdrawFood(s.id, 0.3);
      entity.energy = Math.min(1, entity.energy + got * 0.6);
    }
  }

  if (entity.age >= ENTITY.SPECIALIZE_AGE) {
    entity.isChild = false;
    entity.parentId = -1;
    entity.social.orientation       = rollOrientation(entity.genes);
    entity.social.relationshipStyle = rollRelationshipStyle(entity.genes);
    return {};
  }

  // Follow parent if alive and nearby
  if (entity.parentId !== -1) {
    const parent = allEntities.get(entity.parentId);
    if (!parent || !parent.alive) { entity.parentId = -1; return {}; }
    const d = taxiDist(entity.x, entity.y, parent.x, parent.y);
    if (d > 2) return moveToward(entity.x, entity.y, parent.x, parent.y);
  }

  // Wander a little on their own if no parent
  if (Math.random() < 0.2) return randomMove();
  return {};
}

export function behaviourHunger(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  const childDiscount = entity.isChild ? 0.4 : 1.0;
  const stateDiscount = (entity.social.socialState === 'chatting' ||
                         entity.social.socialState === 'relaxing') ? 0.75 : 1.0;
  const rate = ENTITY.HUNGER_RATE * (1 - entity.genes.resilience * 0.3) * childDiscount * stateDiscount;
  entity.energy -= rate;

  // Pull from settlement food storage when running low
  if (entity.energy < 0.40 && entity.settlementId !== -1) {
    const s = ctx.settlements.getById(entity.settlementId);
    if (s && s.foodStorage > 0.5) {
      const got = ctx.settlements.withdrawFood(s.id, 0.5);
      entity.energy = Math.min(1, entity.energy + got * 0.6);
    }
  }

  if (entity.energy < 0.25) entity.social.stressTicks = Math.min(120, entity.social.stressTicks + 1);
  else if (entity.energy > 0.5) entity.social.stressTicks = Math.max(0, entity.social.stressTicks - 1);

  // Force idle when critically hungry
  if (entity.energy < 0.25 && entity.social.socialState !== 'idle') {
    entity.social.socialState     = 'idle';
    entity.social.socialStateTicks = 0;
  }

  if (entity.energy <= 0) return { die: true };
  return {};
}

// ── Socialise ─────────────────────────────────────────────────

export function behaviourSocialize(ctx: BehaviourContext): BehaviourResult {
  const { entity, neighbours, allEntities } = ctx;
  const s = entity.social;

  // Children don't have orientation set yet; skip most social logic
  if (entity.isChild || !s.orientation) return {};

  // Don't socialise when hungry — food comes first
  if (entity.energy < 0.45) return {};

  // Clean up dead references
  s.partnerIds       = s.partnerIds.filter(id => allEntities.get(id)?.alive);
  s.affairPartnerIds = s.affairPartnerIds.filter(id => allEntities.get(id)?.alive);
  s.friendIds        = s.friendIds.filter(id => allEntities.get(id)?.alive);
  if (s.followingId !== null && !allEntities.get(s.followingId)?.alive) s.followingId = null;

  // Partner proximity tracking
  const allPartnerIds = [...s.partnerIds, ...s.affairPartnerIds];
  const anyNearby = allPartnerIds.some(pid => {
    const p = allEntities.get(pid);
    return p?.alive && taxiDist(entity.x, entity.y, p.x, p.y) <= 5;
  });
  if (anyNearby) s.ticksAloneFromPartners = 0;
  else if (allPartnerIds.length > 0) s.ticksAloneFromPartners++;

  // Breakup due to distance
  if (s.ticksAloneFromPartners > 300 && s.partnerIds.length > 0) {
    _dissolvePartnership(entity, s.partnerIds[0], allEntities);
    s.ticksAloneFromPartners = 0;
  }

  // Stress breakup
  if (s.stressTicks > 60 && s.partnerIds.length > 0 && Math.random() < 0.006) {
    _dissolvePartnership(entity, s.partnerIds[s.partnerIds.length - 1], allEntities);
    s.stressTicks = 0;
  }

  // Affairs
  if (s.affairPartnerIds.length > 0 && s.partnerIds.length > 0) {
    const affairNear = s.affairPartnerIds.some(aid => {
      const a = allEntities.get(aid);
      return a?.alive && taxiDist(entity.x, entity.y, a.x, a.y) <= 3;
    });
    const mainNear = s.partnerIds.some(pid => {
      const p = allEntities.get(pid);
      return p?.alive && taxiDist(entity.x, entity.y, p.x, p.y) <= 3;
    });
    if (affairNear && mainNear && Math.random() < 0.10) {
      const mainId = s.partnerIds[0];
      _dissolvePartnership(entity, mainId, allEntities);
      const affairId = s.affairPartnerIds[0];
      s.affairPartnerIds = s.affairPartnerIds.filter(id => id !== affairId);
      s.partnerIds.push(affairId);
      const affair = allEntities.get(affairId);
      if (affair) {
        affair.social.affairPartnerIds = affair.social.affairPartnerIds.filter(id => id !== entity.id);
        if (!affair.social.partnerIds.includes(entity.id)) affair.social.partnerIds.push(entity.id);
      }
      s.stressTicks += 25;
    }
  }

  // Cheating cooldown
  if (s.cheatCooldown > 0) {
    s.cheatCooldown--;
  } else if (
    s.relationshipStyle === 'monogamous' && s.partnerIds.length >= 1 &&
    s.affairPartnerIds.length === 0 && s.ticksAloneFromPartners > 80 && entity.energy > 0.5
  ) {
    const candidate = neighbours.find(n =>
      n.alive && !n.isChild && n.social.orientation &&
      !s.partnerIds.includes(n.id) && !s.affairPartnerIds.includes(n.id) &&
      isAttractedTo(entity, n) && isAttractedTo(n, entity) &&
      taxiDist(entity.x, entity.y, n.x, n.y) <= 3,
    );
    if (candidate && Math.random() < entity.genes.sociability * 0.15) {
      s.affairPartnerIds.push(candidate.id);
      candidate.social.affairPartnerIds.push(entity.id);
      s.cheatCooldown = 200;
    }
  }

  // Social state tick
  s.socialStateTicks++;
  if (s.socialState === 'chatting') {
    entity.energy = Math.min(1, entity.energy + 0.0004);
    if (s.socialStateTicks >= 15 + Math.floor(entity.genes.sociability * 25)) {
      s.socialState = 'idle'; s.socialStateTicks = 0;
    }
    return {};
  }
  if (s.socialState === 'relaxing') {
    entity.energy = Math.min(1, entity.energy + 0.0008);
    if (s.socialStateTicks >= 30 + Math.floor(entity.genes.resilience * 35)) {
      s.socialState = 'idle'; s.socialStateTicks = 0;
    }
    return {};
  }

  // Follow lower-dominance partner
  if (s.followingId !== null) {
    const leader = allEntities.get(s.followingId);
    if (leader) {
      const d = taxiDist(entity.x, entity.y, leader.x, leader.y);
      if (d > 2) return moveToward(entity.x, entity.y, leader.x, leader.y);
    }
  }

  // Reproduce with established partner
  if (entity.reproductionCooldown > 0) {
    entity.reproductionCooldown--;
  } else if (entity.energy >= ENTITY.REPRO_ENERGY_THRESHOLD) {
    for (const pid of [...s.partnerIds, ...s.affairPartnerIds]) {
      const partner = allEntities.get(pid);
      if (!partner?.alive || partner.reproductionCooldown > 0) continue;
      if (partner.energy < ENTITY.REPRO_ENERGY_THRESHOLD) continue;
      if (!canReproduce(entity, partner)) continue;
      if (taxiDist(entity.x, entity.y, partner.x, partner.y) <= 3) {
        entity.reproductionCooldown = ENTITY.REPRO_COOLDOWN_TICKS;
        entity.energy *= 0.88; // less energy cost than before (was 0.82)
        return { reproduce: true, reproduceWith: pid };
      }
    }
  }

  // Chat / relax with friends
  if (entity.energy > 0.60 && s.socialState === 'idle') {
    const nearFriend = neighbours.find(n =>
      !n.isChild && n.alive && s.friendIds.includes(n.id) &&
      n.social.socialState === 'idle' &&
      taxiDist(entity.x, entity.y, n.x, n.y) <= 2,
    );
    if (nearFriend && Math.random() < entity.genes.sociability * 0.04) {
      s.socialState = 'chatting'; s.socialStateTicks = 0;
      nearFriend.social.socialState     = 'chatting';
      nearFriend.social.socialStateTicks = 0;
      return {};
    }
    if (Math.random() < 0.004) { s.socialState = 'relaxing'; s.socialStateTicks = 0; return {}; }
  }

  // Make friends
  if (s.friendIds.length < 4) {
    const candidate = neighbours.find(n =>
      !n.isChild && n.alive && !s.friendIds.includes(n.id) && !s.partnerIds.includes(n.id) &&
      n.id !== entity.id && taxiDist(entity.x, entity.y, n.x, n.y) <= 3,
    );
    if (candidate && Math.random() < entity.genes.sociability * 0.012) {
      s.friendIds.push(candidate.id);
      if (!candidate.social.friendIds.includes(entity.id)) candidate.social.friendIds.push(entity.id);
    }
  }

  // Seek romantic partner
  if (s.seekCooldown > 0) { s.seekCooldown--; return {}; }

  const maxPartners = s.relationshipStyle === 'polyamorous' ? 3 : 1;
  if (s.partnerIds.length < maxPartners) {
    const candidate = neighbours.find(n => {
      if (n.isChild || !n.alive || !n.social.orientation) return false;
      if (s.partnerIds.includes(n.id) || s.affairPartnerIds.includes(n.id)) return false;
      if (!isAttractedTo(entity, n) || !isAttractedTo(n, entity)) return false;
      const nMax = n.social.relationshipStyle === 'polyamorous' ? 3 : 1;
      if (n.social.partnerIds.length >= nMax) return false;
      return taxiDist(entity.x, entity.y, n.x, n.y) <= 5;
    });
    if (candidate) {
      s.partnerIds.push(candidate.id);
      candidate.social.partnerIds.push(entity.id);
      if (s.dominanceScore < candidate.social.dominanceScore) s.followingId = candidate.id;
      else if (candidate.social.dominanceScore < s.dominanceScore) candidate.social.followingId = entity.id;
      s.seekCooldown = 40 + Math.floor(Math.random() * 30);
      return {};
    }
    // Drift toward compatible distant entity
    if (entity.age > ENTITY.SPECIALIZE_AGE + 5 && entity.energy > 0.45) {
      const distant = neighbours.find(n =>
        !n.isChild && n.alive && n.social.orientation && isAttractedTo(entity, n) &&
        n.social.partnerIds.length < (n.social.relationshipStyle === 'polyamorous' ? 3 : 1),
      );
      if (distant) { s.seekCooldown = 10; return moveToward(entity.x, entity.y, distant.x, distant.y); }
    }
  }

  s.seekCooldown = 20;
  return {};
}

function _dissolvePartnership(entity: EntityState, partnerId: number, allEntities: Map<number, EntityState>): void {
  entity.social.partnerIds       = entity.social.partnerIds.filter(id => id !== partnerId);
  entity.social.affairPartnerIds = entity.social.affairPartnerIds.filter(id => id !== partnerId);
  if (entity.social.followingId === partnerId) entity.social.followingId = null;
  const partner = allEntities.get(partnerId);
  if (partner) {
    partner.social.partnerIds       = partner.social.partnerIds.filter(id => id !== entity.id);
    partner.social.affairPartnerIds = partner.social.affairPartnerIds.filter(id => id !== entity.id);
    if (partner.social.followingId === entity.id) partner.social.followingId = null;
    partner.social.stressTicks += 15;
  }
}

// ── Gathering ─────────────────────────────────────────────────

export function behaviourGather(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, settlements } = ctx;
  const s = entity.social;

  // Children handle their own eating in behaviourGrow
  if (entity.isChild) return {};

  // Don't gather while chatting/relaxing UNLESS genuinely hungry
  if ((s.socialState === 'chatting' || s.socialState === 'relaxing') && entity.energy > 0.35) return {};

  // Don't gather while on a building project
  if (entity.buildingProjectId !== -1) return {};

  // ── Return home if carrying food ──────────────────────────
  if (entity.memory.returning && entity.settlementId !== -1) {
    const settlement = settlements.getById(entity.settlementId);
    if (!settlement) { entity.memory.returning = false; return {}; }
    const d = taxiDist(entity.x, entity.y, settlement.x, settlement.y);
    if (d <= 1) {
      entity.memory.returning = false;
      const deposited = entity.carryingFood;
      entity.carryingFood = 0;
      return { depositFood: deposited };
    }
    return moveToward(entity.x, entity.y, settlement.x, settlement.y);
  }

  // ── Eat in-place when hungry, regardless of settlement status ──
  // KEY FIX: removed the old energy > 0.45 gate — entities always try to eat
  // when below 0.70 so there's no dead zone where hunger drains without action.
  if (entity.energy < 0.70) {
    const tile = world.getTile(entity.x, entity.y);
    if (tile) {
      const food = tile.resources.find(r => r.type === 'food' && r.amount > 0.1);
      if (food) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.4);
        if (extracted > 0) {
          entity.memory.ticksSinceFood = 0;
          entity.actionAnim = { type: 'gather', progress: 0 };
          // Unhoused entities eat directly; settled entities carry and deposit
          if (entity.settlementId === -1) {
            return { eat: extracted };
          } else {
            entity.carryingFood += extracted;
            if (entity.carryingFood >= ENTITY.CARRY_CAPACITY) {
              entity.memory.returning = true;
            }
            // Still eat a small portion immediately to survive
            return { eat: extracted * 0.5 };
          }
        }
      }
    }
  }

  // ── Scan for the best nearby food tile ───────────────────
  // Always scan if energy < 0.85 — don't wait until starving to forage
  if (entity.energy < 0.85) {
    const range = Math.ceil(3 + entity.genes.intelligence * 5);
    let bestTile = null, bestScore = -1;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const t = world.getTile(entity.x + dx, entity.y + dy);
        if (!t || !TILE_PASSABLE[t.type]) continue;
        const food = t.resources.find(r => r.type === 'food' && r.amount > 0.2);
        if (food) {
          const score = food.amount / (Math.abs(dx) + Math.abs(dy) + 1);
          if (score > bestScore) { bestScore = score; bestTile = t; }
        }
      }
    }
    if (bestTile) {
      entity.memory.lastFoodTile = [bestTile.x, bestTile.y];
      if (bestTile.x === entity.x && bestTile.y === entity.y) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.5);
        if (extracted > 0) {
          entity.carryingFood += extracted;
          entity.memory.ticksSinceFood = 0;
          entity.actionAnim = { type: 'gather', progress: 0 };
          if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
            entity.memory.returning = true;
          }
          return { eat: extracted * 0.4 };
        }
        return {};
      }
      return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
    }

    // Head toward remembered food tile
    if (entity.memory.lastFoodTile) {
      const [fx, fy] = entity.memory.lastFoodTile;
      if (taxiDist(entity.x, entity.y, fx, fy) < 2) entity.memory.lastFoodTile = null;
      else return moveToward(entity.x, entity.y, fx, fy);
    }

    // Current tile has low food value — random wander
    const tile = world.getTile(entity.x, entity.y);
    const fv = TILE_FOOD_VALUE[tile?.type ?? 'plains'];
    if (fv < 0.3) return randomMove();
  }

  entity.memory.ticksSinceFood++;
  if (entity.memory.ticksSinceFood > 80) return randomMove();
  return {};
}

export function behaviourHunt(ctx: BehaviourContext): BehaviourResult {
  const { entity, world } = ctx;
  if (entity.isChild || entity.energy > 0.75) return {};
  if (entity.buildingProjectId !== -1) return {};
  const s = entity.social;
  if ((s.socialState === 'chatting' || s.socialState === 'relaxing') && entity.energy > 0.4) return {};

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
    entity.actionAnim = { type: 'gather', progress: 0 };
    return { eat: extracted * 0.5 };
  }
  return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
}

export function behaviourTerritorialWander(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  if (entity.isChild) return {};
  if (entity.social.followingId !== null) return {};
  if (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') return {};
  if (entity.memory.returning) return {};
  if (entity.buildingProjectId !== -1) return {};

  if (entity.memory.homeSettlement) {
    const [hx, hy] = entity.memory.homeSettlement;
    if (taxiDist(entity.x, entity.y, hx, hy) > 20 && Math.random() < 0.3) {
      return moveToward(entity.x, entity.y, hx, hy);
    }
  }
  if (Math.random() < 0.4) return randomMove();
  return {};
}

// ── Farming ───────────────────────────────────────────────────

export function behaviourFarm(ctx: BehaviourContext): BehaviourResult {
  const { entity, world } = ctx;
  if (entity.isChild) return {};
  if (entity.type !== 'farmer' && entity.type !== 'villager') return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};
  if (entity.buildingProjectId !== -1) return {};

  // Only attempt farming when well-fed — don't wander for farm tiles when hungry
  if (entity.energy < 0.50) return {};

  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};

  // Create farm on current plains tile
  if (tile.type === 'plains' && !tile.improvement && Math.random() < 0.002) {
    tile.improvement = 'farm';
    const food = tile.resources.find(r => r.type === 'food');
    if (food) food.regenRate *= 2.5;
    return {};
  }

  // Harvest from farm tile
  if (tile.improvement === 'farm') {
    const extracted = world.extractResource(entity.x, entity.y, 'food', 0.6);
    if (extracted > 0) {
      entity.carryingFood += extracted;
      entity.actionAnim = { type: 'farm', progress: 0 };
      if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
        entity.memory.returning = true;
      }
    }
    return {};
  }

  // Only move toward a farm tile if one is very close (range 3, not 6)
  // This prevents farmers from wandering far away from food looking for farm tiles
  const range = 3;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (t && t.improvement === 'farm' && TILE_PASSABLE[t.type]) {
        return moveToward(entity.x, entity.y, t.x, t.y);
      }
    }
  }
  return {};
}

// ── Mining ────────────────────────────────────────────────────

export function behaviourMine(ctx: BehaviourContext): BehaviourResult {
  const { entity, world } = ctx;
  if (entity.isChild || entity.type !== 'craftsman') return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};
  if (entity.buildingProjectId !== -1) return {};

  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};
  for (const resType of ['stone', 'wood', 'iron'] as const) {
    const res = tile.resources.find(r => r.type === resType && r.amount > 0);
    if (res && Math.random() < 0.05) {
      const extracted = world.extractResource(entity.x, entity.y, resType, 0.5);
      if (extracted > 0) {
        entity.carryingResource += extracted;
        entity.carryingResourceType = resType;
        entity.actionAnim = { type: 'mine', progress: 0 };
        if (entity.carryingResource >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
          entity.memory.returning = true;
        }
        return { extractResource: { type: resType, amount: extracted } };
      }
    }
  }
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

export function behaviourReturnResources(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild) return {};
  if (!entity.memory.returning || entity.carryingResource <= 0 || entity.settlementId === -1) return {};
  const s = settlements.getById(entity.settlementId);
  if (!s) { entity.memory.returning = false; return {}; }
  const d = taxiDist(entity.x, entity.y, s.x, s.y);
  if (d <= 1) {
    if (entity.carryingResourceType) settlements.depositResource(s.id, entity.carryingResourceType, entity.carryingResource);
    entity.carryingResource      = 0;
    entity.carryingResourceType  = null;
    entity.memory.returning      = false;
    return {};
  }
  return moveToward(entity.x, entity.y, s.x, s.y);
}

// ── Building ──────────────────────────────────────────────────

export function behaviourBuild(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild || entity.energy < 0.55) return {};
  if (entity.settlementId === -1) return {};
  if (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') return {};
  if (entity.memory.returning) return {};

  const settlement = settlements.getById(entity.settlementId);
  if (!settlement || settlement.level < 2) return {};

  if (entity.genes.ambition < 0.28 && entity.genes.strength < 0.45) return {};

  if (Math.random() < 0.30) return {};

  const project = settlements.getAvailableProject(entity.settlementId, entity.id);
  if (!project) {
    entity.buildingProjectId = -1;
    return {};
  }

  const targetTile = settlements.getNearestProjectTile(project, entity.x, entity.y);
  if (!targetTile) { entity.buildingProjectId = -1; return {}; }

  const dist = taxiDist(entity.x, entity.y, targetTile[0], targetTile[1]);
  if (dist > 1) {
    entity.buildingProjectId = project.id;
    return moveToward(entity.x, entity.y, targetTile[0], targetTile[1]);
  }

  entity.buildingProjectId  = project.id;
  entity.actionAnim         = { type: 'build', progress: 0 };
  return { workOnProject: { projectId: project.id, tileX: targetTile[0], tileY: targetTile[1] } };
}

// ── Patrol ────────────────────────────────────────────────────

export function behaviourPatrol(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  if (entity.isChild || entity.type !== 'warrior') return {};
  if (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') return {};
  if (entity.memory.homeSettlement && Math.random() < 0.05) {
    const [hx, hy] = entity.memory.homeSettlement;
    if (taxiDist(entity.x, entity.y, hx, hy) > 12) return moveToward(entity.x, entity.y, hx, hy);
  }
  if (Math.random() < 0.3) return randomMove();
  return {};
}

// ── Trade ─────────────────────────────────────────────────────

export function behaviourTrade(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild || entity.type !== 'merchant') return {};
  const home = settlements.getById(entity.settlementId);
  if (!home) return {};
  if (!entity.memory.returning) {
    if (home.foodStorage > home.maxFoodStorage * 0.6 && entity.carryingFood < ENTITY.CARRY_CAPACITY) {
      const taken = settlements.withdrawFood(home.id, ENTITY.CARRY_CAPACITY);
      entity.carryingFood += taken;
      if (entity.carryingFood > 0) entity.memory.returning = true;
    }
    return {};
  }
  const deficit = settlements.getAll().find(s => s.id !== home.id && s.foodStorage < s.maxFoodStorage * 0.3);
  if (!deficit) { entity.memory.returning = false; return {}; }
  const d = taxiDist(entity.x, entity.y, deficit.x, deficit.y);
  if (d <= 1) {
    settlements.depositFood(deficit.id, entity.carryingFood);
    entity.carryingFood    = 0;
    entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, deficit.x, deficit.y);
}

// ── Pipeline registry ─────────────────────────────────────────

export type BehaviourFn = (ctx: BehaviourContext) => BehaviourResult;

export const BEHAVIOUR_PIPELINES: Record<EntityType, BehaviourFn[]> = {
  // hunter_gatherer and villager share the same survival-first pipeline.
  // villagers gain build/farm on top but food always takes priority via
  // the energy guards inside those behaviours.
  hunter_gatherer: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize,
    behaviourHunt, behaviourGather, behaviourTerritorialWander,
  ],
  villager: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize,
    behaviourHunt, behaviourBuild, behaviourFarm, behaviourGather,
    behaviourTerritorialWander,
  ],
  farmer: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize,
    behaviourBuild, behaviourFarm, behaviourGather, behaviourTerritorialWander,
  ],
  craftsman: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize,
    behaviourBuild, behaviourMine, behaviourReturnResources,
    behaviourGather, behaviourTerritorialWander,
  ],
  warrior: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize,
    behaviourGather, behaviourPatrol,
  ],
  merchant: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourTrade, behaviourGather, behaviourTerritorialWander,
  ],
  scholar: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourGather, behaviourTerritorialWander,
  ],
  noble: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourGather,
  ],
};
