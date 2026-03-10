// ============================================================
// BEHAVIOURS — discrete behaviour units for civilization entities.
// ============================================================

import {
  EntityState, EntityType, isAttractedTo, canReproduce,
  rollOrientation, rollRelationshipStyle,
} from './Entity';
import { World } from '../world/World';
import { TILE_FOOD_VALUE, TILE_PASSABLE } from '../world/Tile';
import { ENTITY } from '../config/constants';
import { SettlementManager } from './SettlementManager';

export interface BehaviourContext {
  entity: EntityState;
  world: World;
  neighbours: EntityState[];
  allEntities: Map<number, EntityState>;
  tick: number;
  settlements: SettlementManager;
}

export type BehaviourResult = {
  dx?: number;
  dy?: number;
  eat?: number;
  reproduce?: boolean;
  reproduceWith?: number;
  die?: boolean;
  extractResource?: { type: string; amount: number };
  depositFood?: number;
  depositResource?: { type: 'stone' | 'wood' | 'iron'; amount: number };
  researchTick?: number;
  foundCamp?: boolean;
};

// ── Movement helpers ─────────────────────────────────────────

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

// ── Core behaviours ──────────────────────────────────────────

export function behaviourAge(ctx: BehaviourContext): BehaviourResult {
  ctx.entity.age++;
  if (ctx.entity.age >= ctx.entity.maxAge) return { die: true };
  return {};
}

/** Tick down action animation — keeps it alive for a few ticks */
export function behaviourAnimTick(ctx: BehaviourContext): BehaviourResult {
  const a = ctx.entity.actionAnim;
  if (a.type !== null) {
    a.progress = (a.progress + 1) % 8;
    // Clear after one cycle
    if (a.progress === 0) a.type = null;
  }
  return {};
}

/** Child grows up at SPECIALIZE_AGE; before that it is smaller and follows its parent. */
export function behaviourGrow(ctx: BehaviourContext): BehaviourResult {
  const { entity, allEntities } = ctx;
  if (!entity.isChild) return {};

  if (entity.age >= ENTITY.SPECIALIZE_AGE) {
    entity.isChild = false;
    entity.parentId = -1;
    // Assign social identity
    entity.social.orientation       = rollOrientation(entity.genes);
    entity.social.relationshipStyle = rollRelationshipStyle(entity.genes);
    return {};
  }

  // Follow parent
  if (entity.parentId !== -1) {
    const parent = allEntities.get(entity.parentId);
    if (!parent || !parent.alive) {
      entity.parentId = -1;
      return {};
    }
    const d = taxiDist(entity.x, entity.y, parent.x, parent.y);
    if (d > 1) return moveToward(entity.x, entity.y, parent.x, parent.y);
    return {};
  }

  return {};
}

export function behaviourHunger(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  // Children and resting entities drain less
  const childDiscount  = entity.isChild ? 0.5 : 1.0;
  const stateDiscount  = (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') ? 0.75 : 1.0;
  const rate = ENTITY.HUNGER_RATE * (1 - entity.genes.resilience * 0.3) * childDiscount * stateDiscount;
  entity.energy -= rate;

  if (entity.energy < 0.35 && entity.settlementId !== -1) {
    const s = ctx.settlements.getById(entity.settlementId);
    if (s && s.foodStorage > 0.5) {
      const withdrawn = ctx.settlements.withdrawFood(s.id, 0.4);
      entity.energy = Math.min(1, entity.energy + withdrawn * 0.5);
    }
  }

  if (entity.energy < 0.25) {
    entity.social.stressTicks = Math.min(120, entity.social.stressTicks + 1);
  } else if (entity.energy > 0.5) {
    entity.social.stressTicks = Math.max(0, entity.social.stressTicks - 1);
  }

  // Survival overrides social states
  if (entity.energy < 0.35 && entity.social.socialState !== 'idle') {
    entity.social.socialState = 'idle';
    entity.social.socialStateTicks = 0;
  }

  if (entity.energy <= 0) return { die: true };
  return {};
}

// ── Social / mating / friendship ─────────────────────────────

export function behaviourSocialize(ctx: BehaviourContext): BehaviourResult {
  const { entity, neighbours, allEntities } = ctx;
  const s = entity.social;

  // Children do not socialise romantically
  if (entity.isChild) return {};
  if (!s.orientation) return {};

  // ── 1. Clean up dead entries ──────────────────────────────
  s.partnerIds       = s.partnerIds.filter(id => allEntities.get(id)?.alive);
  s.affairPartnerIds = s.affairPartnerIds.filter(id => allEntities.get(id)?.alive);
  s.friendIds        = s.friendIds.filter(id => allEntities.get(id)?.alive);
  if (s.followingId !== null && !allEntities.get(s.followingId)?.alive) s.followingId = null;

  // ── 2. Partner proximity tracking ────────────────────────
  const allPartnerIds = [...s.partnerIds, ...s.affairPartnerIds];
  const anyPartnerNearby = allPartnerIds.some(pid => {
    const p = allEntities.get(pid);
    return p?.alive && taxiDist(entity.x, entity.y, p.x, p.y) <= 5;
  });
  if (anyPartnerNearby) {
    s.ticksAloneFromPartners = 0;
  } else if (allPartnerIds.length > 0) {
    s.ticksAloneFromPartners++;
  }

  // ── 3. Breakups ───────────────────────────────────────────
  if (s.ticksAloneFromPartners > 300 && s.partnerIds.length > 0) {
    _dissolvePartnership(entity, s.partnerIds[0], allEntities);
    s.ticksAloneFromPartners = 0;
  }
  if (s.stressTicks > 60 && s.partnerIds.length > 0 && Math.random() < 0.006) {
    _dissolvePartnership(entity, s.partnerIds[s.partnerIds.length - 1], allEntities);
    s.stressTicks = 0;
  }

  // ── 4. Affair discovery ───────────────────────────────────
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

  // ── 5. Cheating ───────────────────────────────────────────
  if (s.cheatCooldown > 0) {
    s.cheatCooldown--;
  } else if (
    s.relationshipStyle === 'monogamous' && s.partnerIds.length >= 1 &&
    s.affairPartnerIds.length === 0 && s.ticksAloneFromPartners > 80 &&
    entity.energy > 0.5
  ) {
    const candidate = neighbours.find(n =>
      n.alive && !n.isChild && n.social.orientation &&
      !s.partnerIds.includes(n.id) && !s.affairPartnerIds.includes(n.id) &&
      isAttractedTo(entity, n) && isAttractedTo(n, entity) &&
      taxiDist(entity.x, entity.y, n.x, n.y) <= 3
    );
    if (candidate && Math.random() < entity.genes.sociability * 0.15) {
      s.affairPartnerIds.push(candidate.id);
      candidate.social.affairPartnerIds.push(entity.id);
      s.cheatCooldown = 200;
    }
  }

  // ── 6. Social state ───────────────────────────────────────
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

  // ── 7. Follow partner (lower dominance) ──────────────────
  if (s.followingId !== null) {
    const leader = allEntities.get(s.followingId);
    if (leader) {
      const d = taxiDist(entity.x, entity.y, leader.x, leader.y);
      if (d > 2) return moveToward(entity.x, entity.y, leader.x, leader.y);
    }
  }

  // ── 8. Reproduce with established partner ────────────────
  if (entity.reproductionCooldown > 0) {
    entity.reproductionCooldown--;
  } else if (entity.energy >= ENTITY.REPRO_ENERGY_THRESHOLD) {
    for (const pid of [...s.partnerIds, ...s.affairPartnerIds]) {
      const partner = allEntities.get(pid);
      if (!partner?.alive || partner.reproductionCooldown > 0) continue;
      if (partner.energy < ENTITY.REPRO_ENERGY_THRESHOLD) continue;
      // Biological constraint: must be opposite sex
      if (!canReproduce(entity, partner)) continue;
      if (taxiDist(entity.x, entity.y, partner.x, partner.y) <= 3) {
        entity.reproductionCooldown = ENTITY.REPRO_COOLDOWN_TICKS;
        entity.energy *= 0.82;
        return { reproduce: true, reproduceWith: pid };
      }
    }
  }

  // ── 9. Chat / relax with friends ─────────────────────────
  if (entity.energy > 0.55 && s.socialState === 'idle') {
    const nearFriend = neighbours.find(n =>
      !n.isChild && n.alive && s.friendIds.includes(n.id) &&
      n.social.socialState === 'idle' &&
      taxiDist(entity.x, entity.y, n.x, n.y) <= 2
    );
    if (nearFriend && Math.random() < entity.genes.sociability * 0.04) {
      s.socialState = 'chatting'; s.socialStateTicks = 0;
      nearFriend.social.socialState = 'chatting'; nearFriend.social.socialStateTicks = 0;
      return {};
    }
    if (Math.random() < 0.004) { s.socialState = 'relaxing'; s.socialStateTicks = 0; return {}; }
  }

  // ── 10. Make friends ──────────────────────────────────────
  if (s.friendIds.length < 4) {
    const candidate = neighbours.find(n =>
      !n.isChild && n.alive && !s.friendIds.includes(n.id) && !s.partnerIds.includes(n.id) &&
      n.id !== entity.id && taxiDist(entity.x, entity.y, n.x, n.y) <= 3
    );
    if (candidate && Math.random() < entity.genes.sociability * 0.012) {
      s.friendIds.push(candidate.id);
      if (!candidate.social.friendIds.includes(entity.id)) candidate.social.friendIds.push(entity.id);
    }
  }

  // ── 11. Seek romantic partner ─────────────────────────────
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
    // Long-range: drift toward distant compatible entity
    if (entity.age > ENTITY.SPECIALIZE_AGE + 5 && entity.energy > 0.45) {
      const distant = neighbours.find(n =>
        !n.isChild && n.alive && n.social.orientation && isAttractedTo(entity, n) &&
        n.social.partnerIds.length < (n.social.relationshipStyle === 'polyamorous' ? 3 : 1)
      );
      if (distant) { s.seekCooldown = 10; return moveToward(entity.x, entity.y, distant.x, distant.y); }
    }
  }

  s.seekCooldown = 20;
  return {};
}

function _dissolvePartnership(entity: EntityState, partnerId: number, allEntities: Map<number, EntityState>): void {
  entity.social.partnerIds      = entity.social.partnerIds.filter(id => id !== partnerId);
  entity.social.affairPartnerIds = entity.social.affairPartnerIds.filter(id => id !== partnerId);
  if (entity.social.followingId === partnerId) entity.social.followingId = null;
  const partner = allEntities.get(partnerId);
  if (partner) {
    partner.social.partnerIds      = partner.social.partnerIds.filter(id => id !== entity.id);
    partner.social.affairPartnerIds = partner.social.affairPartnerIds.filter(id => id !== entity.id);
    if (partner.social.followingId === entity.id) partner.social.followingId = null;
    partner.social.stressTicks += 15;
  }
}

// ── Camp founding ─────────────────────────────────────────────

/**
 * When an entity has plenty of food, is in a tribe, and no camp exists nearby,
 * a high-ambition individual will naturally start one.
 */
export function behaviourFoundCamp(ctx: BehaviourContext): BehaviourResult {
  const { entity, neighbours, world, settlements } = ctx;
  if (entity.isChild) return {};
  if (entity.settlementId !== -1) return {};  // already in a settlement
  if (entity.tribeId === -1) return {};
  if (entity.energy < 0.72) return {};        // only when fed and comfortable
  if (entity.genes.ambition < 0.38) return {};

  // Only one attempt every so often
  if (entity.age % 30 !== 0) return {};

  // Count nearby tribe members
  const tribeNearby = neighbours.filter(n =>
    !n.isChild && n.tribeId === entity.tribeId && taxiDist(entity.x, entity.y, n.x, n.y) <= 12
  );
  if (tribeNearby.length < 2) return {};

  // Check no existing settlement is close
  const allSettlements = settlements.getAll();
  const tooClose = allSettlements.some(s => taxiDist(entity.x, entity.y, s.x, s.y) < 18);
  if (tooClose) return {};

  return { foundCamp: true };
}

// ── Gathering behaviours ──────────────────────────────────────

export function behaviourGather(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, settlements } = ctx;
  const s = entity.social;
  if (entity.isChild) return {};
  if ((s.socialState === 'chatting' || s.socialState === 'relaxing') && entity.energy > 0.4) return {};

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

  // Eat in-place when starving with no camp
  if (entity.energy < 0.4 && entity.settlementId === -1) {
    const tile = world.getTile(entity.x, entity.y);
    if (tile) {
      const food = tile.resources.find(r => r.type === 'food' && r.amount > 0);
      if (food) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.3);
        entity.memory.ticksSinceFood = 0;
        entity.actionAnim = { type: 'gather', progress: 0 };
        return { eat: extracted };
      }
    }
  }

  if (entity.energy > 0.45) {
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
      if (bestTile.x === entity.x && bestTile.y === entity.y) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.5);
        if (extracted > 0) {
          entity.carryingFood += extracted;
          entity.memory.ticksSinceFood = 0;
          entity.actionAnim = { type: 'gather', progress: 0 };
          // Camp storage: deposit when carrying limit reached
          if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
            entity.memory.returning = true;
          }
        }
        return {};
      }
      return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
    }
    if (entity.memory.lastFoodTile) {
      const [fx, fy] = entity.memory.lastFoodTile;
      if (taxiDist(entity.x, entity.y, fx, fy) < 2) entity.memory.lastFoodTile = null;
      else return moveToward(entity.x, entity.y, fx, fy);
    }
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
  if (entity.isChild) return {};
  if (entity.energy > 0.6) return {};
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
    return {};
  }
  return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
}

export function behaviourTerritorialWander(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  if (entity.isChild) return {};
  if (entity.social.followingId !== null) return {};
  if (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') return {};
  if (entity.memory.returning) return {};

  if (entity.memory.homeSettlement) {
    const [hx, hy] = entity.memory.homeSettlement;
    const d = taxiDist(entity.x, entity.y, hx, hy);
    if (d > 20 && Math.random() < 0.3) return moveToward(entity.x, entity.y, hx, hy);
  }
  if (Math.random() < 0.4) return randomMove();
  return {};
}

export function behaviourFarm(ctx: BehaviourContext): BehaviourResult {
  const { entity, world } = ctx;
  if (entity.isChild) return {};
  if (entity.type !== 'farmer' && entity.type !== 'villager') return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};

  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};
  if (tile.type === 'plains' && !tile.improvement && Math.random() < 0.002) {
    tile.improvement = 'farm';
    const food = tile.resources.find(r => r.type === 'food');
    if (food) food.regenRate *= 2.5;
    return {};
  }
  if (tile.improvement === 'farm') {
    const extracted = world.extractResource(entity.x, entity.y, 'food', 0.6);
    if (extracted > 0) {
      entity.carryingFood += extracted;
      entity.actionAnim = { type: 'farm', progress: 0 };
      if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) entity.memory.returning = true;
    }
    return {};
  }
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

export function behaviourMine(ctx: BehaviourContext): BehaviourResult {
  const { entity, world } = ctx;
  if (entity.isChild) return {};
  if (entity.type !== 'craftsman') return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};

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
        if (entity.carryingResource >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) entity.memory.returning = true;
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
    entity.carryingResource = 0;
    entity.carryingResourceType = null;
    entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, s.x, s.y);
}

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
    entity.carryingFood = 0;
    entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, deficit.x, deficit.y);
}

export function behaviourResearch(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  if (entity.isChild || entity.type !== 'scholar') return {};
  return { researchTick: 0.02 + entity.genes.creativity * 0.05 };
}

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

export function behaviourAdminister(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild || entity.type !== 'noble') return {};
  if (entity.settlementId !== -1) {
    const s = settlements.getById(entity.settlementId);
    if (s) s.techPoints += 0.001;
  }
  if (Math.random() < 0.1) return randomMove();
  return {};
}

// ── Behaviour pipeline registry ──────────────────────────────

export type BehaviourFn = (ctx: BehaviourContext) => BehaviourResult;

export const BEHAVIOUR_PIPELINES: Record<EntityType, BehaviourFn[]> = {
  hunter_gatherer: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourFoundCamp,
    behaviourHunt, behaviourGather, behaviourTerritorialWander,
  ],
  villager: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourFoundCamp,
    behaviourFarm, behaviourGather, behaviourTerritorialWander,
  ],
  farmer: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourFarm, behaviourTerritorialWander,
  ],
  craftsman: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourMine,
    behaviourReturnResources, behaviourTerritorialWander,
  ],
  warrior: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourPatrol,
  ],
  merchant: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourTrade, behaviourTerritorialWander,
  ],
  scholar: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourResearch, behaviourTerritorialWander,
  ],
  noble: [
    behaviourAge, behaviourAnimTick, behaviourGrow, behaviourHunger,
    behaviourSocialize, behaviourAdminister,
  ],
};
