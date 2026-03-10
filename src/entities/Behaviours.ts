// ============================================================
// BEHAVIOURS — single universal pipeline for all persons.
// Skills gate effectiveness; no hard type switches.
// ============================================================

import {
  EntityState, EntityRole, isAttractedTo, canReproduce,
  rollOrientation, rollRelationshipStyle, gainSkill, deriveRole,
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
  nowMs:       number; // wall-clock ms for animation timing
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

function moveToward(ex: number, ey: number, tx: number, ty: number) {
  return { dx: Math.sign(tx - ex), dy: Math.sign(ty - ey) };
}

function taxiDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// ── Animation helper ──────────────────────────────────────────

/**
 * Start or refresh an action animation.
 * Uses wall-clock ms so it plays smoothly between ticks.
 * Duration is scaled by skill — more skilled = snappier animations.
 */
function startAnim(
  entity: EntityState,
  type: NonNullable<typeof entity.actionAnim.type>,
  nowMs: number,
  skillLevel: number = 0,
): void {
  const base = type === 'build' ? 1200 : type === 'mine' ? 1000 : type === 'farm' ? 900 : 700;
  // Skilled workers animate faster (down to 60% of base at skill 100)
  const duration = base * (1 - skillLevel * 0.004);
  entity.actionAnim = { type, progress: 0, duration, startMs: nowMs };
}

/** Advance animation progress based on elapsed wall-clock time. */
export function tickAnim(entity: EntityState, nowMs: number): void {
  const a = entity.actionAnim;
  if (a.type === null) return;
  const elapsed = nowMs - a.startMs;
  a.progress = Math.min(1, elapsed / a.duration);
  // Loop — keep playing while the action is still happening
  if (a.progress >= 1) {
    a.startMs = nowMs; // restart loop
    a.progress = 0;
  }
}

// ── behaviourAge ─────────────────────────────────────────────

export function behaviourAge(ctx: BehaviourContext): BehaviourResult {
  const { entity, nowMs } = ctx;
  entity.age++;

  // Update cosmetic role every tick from current skills
  entity.type = deriveRole(entity);

  // Advance animation
  tickAnim(entity, nowMs);

  if (entity.age >= entity.maxAge) return { die: true };
  return {};
}

// ── behaviourGrow ─────────────────────────────────────────────

export function behaviourGrow(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, allEntities } = ctx;
  if (!entity.isChild) return {};

  // Children eat from current tile so they don't silently starve
  const tile = world.getTile(entity.x, entity.y);
  if (tile && entity.energy < 0.65) {
    const food = tile.resources.find(r => r.type === 'food' && r.amount > 0.1);
    if (food) {
      const got = world.extractResource(entity.x, entity.y, 'food', 0.2);
      entity.energy = Math.min(1, entity.energy + got * 0.5);
    }
  }
  // Pull from settlement food stores
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

  if (entity.parentId !== -1) {
    const parent = allEntities.get(entity.parentId);
    if (!parent || !parent.alive) { entity.parentId = -1; return {}; }
    const d = taxiDist(entity.x, entity.y, parent.x, parent.y);
    if (d > 2) return moveToward(entity.x, entity.y, parent.x, parent.y);
  }

  if (Math.random() < 0.2) return randomMove();
  return {};
}

// ── behaviourHunger ───────────────────────────────────────────

export function behaviourHunger(ctx: BehaviourContext): BehaviourResult {
  const { entity } = ctx;
  const childDiscount = entity.isChild ? 0.4 : 1.0;
  const restDiscount  = (entity.social.socialState === 'chatting' ||
                         entity.social.socialState === 'relaxing') ? 0.75 : 1.0;
  const rate = ENTITY.HUNGER_RATE
    * (1 - entity.genes.resilience * 0.3)
    * childDiscount
    * restDiscount;
  entity.energy -= rate;

  // Pull from settlement food when getting low
  if (entity.energy < 0.40 && entity.settlementId !== -1) {
    const s = ctx.settlements.getById(entity.settlementId);
    if (s && s.foodStorage > 0.5) {
      const got = ctx.settlements.withdrawFood(s.id, 0.5);
      entity.energy = Math.min(1, entity.energy + got * 0.6);
    }
  }

  if (entity.energy < 0.25) entity.social.stressTicks = Math.min(120, entity.social.stressTicks + 1);
  else if (entity.energy > 0.5) entity.social.stressTicks = Math.max(0, entity.social.stressTicks - 1);

  if (entity.energy < 0.25 && entity.social.socialState !== 'idle') {
    entity.social.socialState     = 'idle';
    entity.social.socialStateTicks = 0;
  }

  if (entity.energy <= 0) return { die: true };
  return {};
}

// ── behaviourSocialize ────────────────────────────────────────

export function behaviourSocialize(ctx: BehaviourContext): BehaviourResult {
  const { entity, neighbours, allEntities } = ctx;
  const s = entity.social;
  if (entity.isChild || !s.orientation) return {};
  if (entity.energy < 0.45) return {};

  // Clean dead refs
  s.partnerIds       = s.partnerIds.filter(id => allEntities.get(id)?.alive);
  s.affairPartnerIds = s.affairPartnerIds.filter(id => allEntities.get(id)?.alive);
  s.friendIds        = s.friendIds.filter(id => allEntities.get(id)?.alive);
  if (s.followingId !== null && !allEntities.get(s.followingId)?.alive) s.followingId = null;

  // Partner proximity
  const allPartnerIds = [...s.partnerIds, ...s.affairPartnerIds];
  const anyNearby = allPartnerIds.some(pid => {
    const p = allEntities.get(pid);
    return p?.alive && taxiDist(entity.x, entity.y, p.x, p.y) <= 5;
  });
  if (anyNearby) s.ticksAloneFromPartners = 0;
  else if (allPartnerIds.length > 0) s.ticksAloneFromPartners++;

  if (s.ticksAloneFromPartners > 300 && s.partnerIds.length > 0) {
    _dissolvePartnership(entity, s.partnerIds[0], allEntities);
    s.ticksAloneFromPartners = 0;
  }
  if (s.stressTicks > 60 && s.partnerIds.length > 0 && Math.random() < 0.006) {
    _dissolvePartnership(entity, s.partnerIds[s.partnerIds.length - 1], allEntities);
    s.stressTicks = 0;
  }

  // Affairs
  if (s.affairPartnerIds.length > 0 && s.partnerIds.length > 0) {
    const affNear  = s.affairPartnerIds.some(id => { const a = allEntities.get(id); return a?.alive && taxiDist(entity.x, entity.y, a.x, a.y) <= 3; });
    const mainNear = s.partnerIds.some(id => { const p = allEntities.get(id); return p?.alive && taxiDist(entity.x, entity.y, p.x, p.y) <= 3; });
    if (affNear && mainNear && Math.random() < 0.10) {
      const mainId   = s.partnerIds[0];
      _dissolvePartnership(entity, mainId, allEntities);
      const affId = s.affairPartnerIds[0];
      s.affairPartnerIds = s.affairPartnerIds.filter(id => id !== affId);
      s.partnerIds.push(affId);
      const aff = allEntities.get(affId);
      if (aff) {
        aff.social.affairPartnerIds = aff.social.affairPartnerIds.filter(id => id !== entity.id);
        if (!aff.social.partnerIds.includes(entity.id)) aff.social.partnerIds.push(entity.id);
      }
      s.stressTicks += 25;
    }
  }

  if (s.cheatCooldown > 0) s.cheatCooldown--;
  else if (s.relationshipStyle === 'monogamous' && s.partnerIds.length >= 1 &&
           s.affairPartnerIds.length === 0 && s.ticksAloneFromPartners > 80 && entity.energy > 0.5) {
    const cand = neighbours.find(n =>
      n.alive && !n.isChild && n.social.orientation &&
      !s.partnerIds.includes(n.id) && !s.affairPartnerIds.includes(n.id) &&
      isAttractedTo(entity, n) && isAttractedTo(n, entity) &&
      taxiDist(entity.x, entity.y, n.x, n.y) <= 3,
    );
    if (cand && Math.random() < entity.genes.sociability * 0.15) {
      s.affairPartnerIds.push(cand.id);
      cand.social.affairPartnerIds.push(entity.id);
      s.cheatCooldown = 200;
    }
  }

  s.socialStateTicks++;
  if (s.socialState === 'chatting') {
    entity.energy = Math.min(1, entity.energy + 0.0004);
    // Gain tiny study skill from conversation
    gainSkill(entity.skills, 'study', 0.005);
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

  // Reproduce
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
        entity.energy *= 0.88;
        return { reproduce: true, reproduceWith: pid };
      }
    }
  }

  // Chat with friends
  if (entity.energy > 0.60 && s.socialState === 'idle') {
    const nearFriend = neighbours.find(n =>
      !n.isChild && n.alive && s.friendIds.includes(n.id) &&
      n.social.socialState === 'idle' && taxiDist(entity.x, entity.y, n.x, n.y) <= 2,
    );
    if (nearFriend && Math.random() < entity.genes.sociability * 0.04) {
      s.socialState = 'chatting'; s.socialStateTicks = 0;
      nearFriend.social.socialState = 'chatting'; nearFriend.social.socialStateTicks = 0;
      return {};
    }
    if (Math.random() < 0.004) { s.socialState = 'relaxing'; s.socialStateTicks = 0; return {}; }
  }

  // Make friends
  if (s.friendIds.length < 4) {
    const cand = neighbours.find(n =>
      !n.isChild && n.alive && !s.friendIds.includes(n.id) && !s.partnerIds.includes(n.id) &&
      n.id !== entity.id && taxiDist(entity.x, entity.y, n.x, n.y) <= 3,
    );
    if (cand && Math.random() < entity.genes.sociability * 0.012) {
      s.friendIds.push(cand.id);
      if (!cand.social.friendIds.includes(entity.id)) cand.social.friendIds.push(entity.id);
    }
  }

  // Seek partner
  if (s.seekCooldown > 0) { s.seekCooldown--; return {}; }
  const maxP = s.relationshipStyle === 'polyamorous' ? 3 : 1;
  if (s.partnerIds.length < maxP) {
    const cand = neighbours.find(n => {
      if (n.isChild || !n.alive || !n.social.orientation) return false;
      if (s.partnerIds.includes(n.id) || s.affairPartnerIds.includes(n.id)) return false;
      if (!isAttractedTo(entity, n) || !isAttractedTo(n, entity)) return false;
      return n.social.partnerIds.length < (n.social.relationshipStyle === 'polyamorous' ? 3 : 1) &&
             taxiDist(entity.x, entity.y, n.x, n.y) <= 5;
    });
    if (cand) {
      s.partnerIds.push(cand.id); cand.social.partnerIds.push(entity.id);
      if (s.dominanceScore < cand.social.dominanceScore) s.followingId = cand.id;
      else if (cand.social.dominanceScore < s.dominanceScore) cand.social.followingId = entity.id;
      s.seekCooldown = 40 + Math.floor(Math.random() * 30);
      return {};
    }
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

function _dissolvePartnership(entity: EntityState, partnerId: number, all: Map<number, EntityState>): void {
  entity.social.partnerIds       = entity.social.partnerIds.filter(id => id !== partnerId);
  entity.social.affairPartnerIds = entity.social.affairPartnerIds.filter(id => id !== partnerId);
  if (entity.social.followingId === partnerId) entity.social.followingId = null;
  const p = all.get(partnerId);
  if (p) {
    p.social.partnerIds       = p.social.partnerIds.filter(id => id !== entity.id);
    p.social.affairPartnerIds = p.social.affairPartnerIds.filter(id => id !== entity.id);
    if (p.social.followingId === entity.id) p.social.followingId = null;
    p.social.stressTicks += 15;
  }
}

// ── behaviourGather ───────────────────────────────────────────

export function behaviourGather(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, settlements, nowMs } = ctx;
  if (entity.isChild) return {};
  const soc = entity.social;
  if ((soc.socialState === 'chatting' || soc.socialState === 'relaxing') && entity.energy > 0.35) return {};
  if (entity.buildingProjectId !== -1) return {};

  // Skill-scaled yield: gathering skill improves how much food is extracted
  const gatherBonus = 1 + entity.skills.gathering * 0.015;

  // Return home if loaded with food
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

  // Always attempt to eat/gather when below 0.85 — no dead zone
  if (entity.energy < 0.85) {
    const tile = world.getTile(entity.x, entity.y);
    if (tile) {
      const food = tile.resources.find(r => r.type === 'food' && r.amount > 0.1);
      if (food) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.4 * gatherBonus);
        if (extracted > 0) {
          entity.memory.ticksSinceFood = 0;
          // Keep animation alive as long as eating is happening
          startAnim(entity, 'gather', nowMs, entity.skills.gathering);
          gainSkill(entity.skills, 'gathering', 0.08);

          if (entity.settlementId === -1) {
            return { eat: extracted };
          } else {
            entity.carryingFood += extracted;
            if (entity.carryingFood >= ENTITY.CARRY_CAPACITY) entity.memory.returning = true;
            return { eat: extracted * 0.45 };
          }
        }
      }
    }

    // Scan for best nearby food
    const range = Math.ceil(3 + entity.genes.intelligence * 4 + entity.skills.gathering * 0.08);
    let bestTile = null, bestScore = -1;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const t = world.getTile(entity.x + dx, entity.y + dy);
        if (!t || !TILE_PASSABLE[t.type]) continue;
        const f = t.resources.find(r => r.type === 'food' && r.amount > 0.2);
        if (f) {
          const score = f.amount / (Math.abs(dx) + Math.abs(dy) + 1);
          if (score > bestScore) { bestScore = score; bestTile = t; }
        }
      }
    }
    if (bestTile) {
      entity.memory.lastFoodTile = [bestTile.x, bestTile.y];
      if (bestTile.x === entity.x && bestTile.y === entity.y) {
        const extracted = world.extractResource(entity.x, entity.y, 'food', 0.5 * gatherBonus);
        if (extracted > 0) {
          entity.carryingFood += extracted;
          entity.memory.ticksSinceFood = 0;
          startAnim(entity, 'gather', nowMs, entity.skills.gathering);
          gainSkill(entity.skills, 'gathering', 0.08);
          if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
            entity.memory.returning = true;
          }
          return { eat: extracted * 0.4 };
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
    const tile2 = world.getTile(entity.x, entity.y);
    if ((TILE_FOOD_VALUE[tile2?.type ?? 'plains'] ?? 0) < 0.3) return randomMove();
  }

  entity.memory.ticksSinceFood++;
  if (entity.memory.ticksSinceFood > 80) return randomMove();
  return {};
}

// ── behaviourHunt ─────────────────────────────────────────────

export function behaviourHunt(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, nowMs } = ctx;
  if (entity.isChild || entity.energy > 0.75) return {};
  if (entity.buildingProjectId !== -1) return {};
  const soc = entity.social;
  if ((soc.socialState === 'chatting' || soc.socialState === 'relaxing') && entity.energy > 0.4) return {};

  const huntBonus = 1 + entity.skills.hunting * 0.02;
  const range = Math.ceil(4 + entity.genes.strength * 4 + entity.skills.hunting * 0.1);
  let bestTile = null, bestScore = -1;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (!t || !TILE_PASSABLE[t.type]) continue;
      const f = t.resources.find(r => r.type === 'food' && r.amount > 0.5);
      if (f) {
        const score = f.amount * huntBonus / (Math.abs(dx) + Math.abs(dy) + 1);
        if (score > bestScore) { bestScore = score; bestTile = t; }
      }
    }
  }
  if (!bestTile) return {};
  if (bestTile.x === entity.x && bestTile.y === entity.y) {
    const extracted = world.extractResource(entity.x, entity.y, 'food', (0.4 + entity.genes.strength * 0.3) * huntBonus);
    entity.carryingFood += extracted;
    startAnim(entity, 'gather', nowMs, entity.skills.hunting);
    gainSkill(entity.skills, 'hunting', 0.1);
    return { eat: extracted * 0.5 };
  }
  return moveToward(entity.x, entity.y, bestTile.x, bestTile.y);
}

// ── behaviourFarm ─────────────────────────────────────────────

export function behaviourFarm(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, nowMs } = ctx;
  if (entity.isChild) return {};
  // Only farm if they have some farming skill or creative genes
  const canFarm = entity.skills.farming >= 2 || entity.genes.creativity > 0.5;
  if (!canFarm) return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};
  if (entity.buildingProjectId !== -1) return {};
  if (entity.energy < 0.50) return {};

  const farmBonus = 1 + entity.skills.farming * 0.015;
  const tile = world.getTile(entity.x, entity.y);
  if (!tile) return {};

  if (tile.type === 'plains' && !tile.improvement && Math.random() < 0.002 * (1 + entity.skills.farming * 0.05)) {
    tile.improvement = 'farm';
    const food = tile.resources.find(r => r.type === 'food');
    if (food) food.regenRate *= 2.5;
    gainSkill(entity.skills, 'farming', 0.5);
    return {};
  }
  if (tile.improvement === 'farm') {
    const extracted = world.extractResource(entity.x, entity.y, 'food', 0.6 * farmBonus);
    if (extracted > 0) {
      entity.carryingFood += extracted;
      startAnim(entity, 'farm', nowMs, entity.skills.farming);
      gainSkill(entity.skills, 'farming', 0.12);
      if (entity.carryingFood >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
        entity.memory.returning = true;
      }
    }
    return {};
  }

  // Only seek a farm tile if one is very close
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const t = world.getTile(entity.x + dx, entity.y + dy);
      if (t && t.improvement === 'farm' && TILE_PASSABLE[t.type]) {
        return moveToward(entity.x, entity.y, t.x, t.y);
      }
    }
  }
  return {};
}

// ── behaviourMine ─────────────────────────────────────────────

export function behaviourMine(ctx: BehaviourContext): BehaviourResult {
  const { entity, world, nowMs } = ctx;
  if (entity.isChild) return {};
  // Needs some crafting skill to mine
  if (entity.skills.crafting < 3 && entity.genes.strength < 0.55) return {};
  if ((entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') && entity.energy > 0.4) return {};
  if (entity.buildingProjectId !== -1) return {};

  const mineBonus = 1 + entity.skills.crafting * 0.018;
  const tile = world.getTile(entity.x, entity.y);
  if (tile) {
    for (const resType of ['stone', 'wood', 'iron'] as const) {
      const res = tile.resources.find(r => r.type === resType && r.amount > 0);
      if (res && Math.random() < 0.05) {
        const extracted = world.extractResource(entity.x, entity.y, resType, 0.5 * mineBonus);
        if (extracted > 0) {
          entity.carryingResource += extracted;
          entity.carryingResourceType = resType;
          startAnim(entity, 'mine', nowMs, entity.skills.crafting);
          gainSkill(entity.skills, 'crafting', 0.12);
          if (entity.carryingResource >= ENTITY.CARRY_CAPACITY && entity.settlementId !== -1) {
            entity.memory.returning = true;
          }
          return { extractResource: { type: resType, amount: extracted } };
        }
      }
    }
  }

  const range = Math.ceil(6 + entity.skills.crafting * 0.15);
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

// ── behaviourReturnResources ──────────────────────────────────

export function behaviourReturnResources(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild) return {};
  if (!entity.memory.returning || entity.carryingResource <= 0 || entity.settlementId === -1) return {};
  const s = settlements.getById(entity.settlementId);
  if (!s) { entity.memory.returning = false; return {}; }
  const d = taxiDist(entity.x, entity.y, s.x, s.y);
  if (d <= 1) {
    if (entity.carryingResourceType) settlements.depositResource(s.id, entity.carryingResourceType, entity.carryingResource);
    entity.carryingResource = 0; entity.carryingResourceType = null; entity.memory.returning = false;
    return {};
  }
  return moveToward(entity.x, entity.y, s.x, s.y);
}

// ── behaviourBuild ────────────────────────────────────────────

export function behaviourBuild(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements, nowMs } = ctx;
  if (entity.isChild || entity.energy < 0.55) return {};
  if (entity.settlementId === -1) return {};
  if (entity.social.socialState === 'chatting' || entity.social.socialState === 'relaxing') return {};
  if (entity.memory.returning) return {};

  const settlement = settlements.getById(entity.settlementId);
  if (!settlement || settlement.level < 2) return {};

  // Needs either some building skill, strong genes, or ambition
  const canBuild = entity.skills.building >= 2
    || entity.genes.ambition >= 0.45
    || entity.genes.strength >= 0.55;
  if (!canBuild) return {};

  if (Math.random() < 0.28) return {};

  const project = settlements.getAvailableProject(entity.settlementId, entity.id);
  if (!project) { entity.buildingProjectId = -1; return {}; }

  const targetTile = settlements.getNearestProjectTile(project, entity.x, entity.y);
  if (!targetTile) { entity.buildingProjectId = -1; return {}; }

  const dist = taxiDist(entity.x, entity.y, targetTile[0], targetTile[1]);
  if (dist > 1) {
    entity.buildingProjectId = project.id;
    return moveToward(entity.x, entity.y, targetTile[0], targetTile[1]);
  }

  entity.buildingProjectId = project.id;
  startAnim(entity, 'build', nowMs, entity.skills.building);
  gainSkill(entity.skills, 'building', 0.15);
  return { workOnProject: { projectId: project.id, tileX: targetTile[0], tileY: targetTile[1] } };
}

// ── behaviourTerritorialWander ────────────────────────────────

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

// ── behaviourTrade ────────────────────────────────────────────

export function behaviourTrade(ctx: BehaviourContext): BehaviourResult {
  const { entity, settlements } = ctx;
  if (entity.isChild) return {};
  // Trading only if they have meaningful trading skill
  if (entity.skills.trading < 5 && entity.genes.sociability < 0.6) return {};
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
    entity.carryingFood = 0; entity.memory.returning = false;
    gainSkill(entity.skills, 'trading', 0.5);
    return {};
  }
  return moveToward(entity.x, entity.y, deficit.x, deficit.y);
}

// ── SINGLE UNIVERSAL PIPELINE ─────────────────────────────────
//
// Every person runs the same pipeline. Skill/gene guards inside
// each behaviour determine whether it activates. The order is
// intentional: survival first, specialisation second.

export type BehaviourFn = (ctx: BehaviourContext) => BehaviourResult;

// Single entry — no per-type dispatch needed anymore.
export const PERSON_PIPELINE: BehaviourFn[] = [
  behaviourAge,
  behaviourGrow,
  behaviourHunger,
  behaviourSocialize,
  behaviourHunt,        // activates when hungry & hunting skill or strength is present
  behaviourBuild,       // activates when in settlement level 2+, has skill/ambition
  behaviourFarm,        // activates when farming skill or creativity gene is present
  behaviourMine,        // activates when crafting skill or strength gene is present
  behaviourReturnResources,
  behaviourTrade,       // activates when trading skill or sociability gene is high
  behaviourGather,      // universal fallback — always runs if hungry
  behaviourTerritorialWander,
];

// Legacy map — EntityManager still references BEHAVIOUR_PIPELINES keyed by type.
// Point every role at the single pipeline.
export const BEHAVIOUR_PIPELINES: Record<EntityRole, BehaviourFn[]> = {
  wanderer:  PERSON_PIPELINE,
  hunter:    PERSON_PIPELINE,
  gatherer:  PERSON_PIPELINE,
  farmer:    PERSON_PIPELINE,
  builder:   PERSON_PIPELINE,
  crafter:   PERSON_PIPELINE,
  warrior:   PERSON_PIPELINE,
  merchant:  PERSON_PIPELINE,
  scholar:   PERSON_PIPELINE,
  elder:     PERSON_PIPELINE,
};
