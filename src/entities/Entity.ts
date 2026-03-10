// ============================================================
// ENTITY — core data types
// Skills replace hard entity types. Every person runs the same
// behaviour pipeline; skill levels gate effectiveness.
// ============================================================

import { ENTITY } from '../config/constants';

// Display-only role derived from dominant skill — NOT used to gate behaviour.
export type EntityRole =
  | 'wanderer'
  | 'hunter'
  | 'gatherer'
  | 'farmer'
  | 'builder'
  | 'crafter'
  | 'warrior'
  | 'merchant'
  | 'scholar'
  | 'elder';

// Legacy alias so any remaining EntityType imports still compile.
export type EntityType = EntityRole;

export type Gender = 'male' | 'female';
export type Orientation = 'straight' | 'gay' | 'bi';
export type RelationshipStyle = 'monogamous' | 'polyamorous';
export type SocialState = 'idle' | 'chatting' | 'relaxing' | 'seeking';
export type ActionType = 'gather' | 'mine' | 'farm' | 'build' | null;

// ── Skills ────────────────────────────────────────────────────

export interface Skills {
  /** Improves hunting range and food extraction yield */
  hunting:   number;
  /** Improves food scan range and foraging yield */
  gathering: number;
  /** Unlocks farm creation; improves harvest rate */
  farming:   number;
  /** Unlocks and speeds building contributions */
  building:  number;
  /** Improves mining yield and ore detection range */
  crafting:  number;
  /** Improves trade route efficiency */
  trading:   number;
  /** Passive — generates tech points for settlement */
  study:     number;
}

export function createSkills(): Skills {
  return { hunting: 0, gathering: 0, farming: 0, building: 0, crafting: 0, trading: 0, study: 0 };
}

/**
 * Gain XP in a skill with diminishing returns.
 * Each unit of experience is worth less as the skill grows.
 * Effective cap is 100.
 */
export function gainSkill(skills: Skills, key: keyof Skills, amount: number): void {
  const current = skills[key];
  const effective = amount / (1 + current * 0.04);
  skills[key] = Math.min(100, current + effective);
}

/**
 * Derive a display role from the entity's dominant skill.
 * Pure cosmetic — never drives pipeline selection.
 */
export function deriveRole(entity: EntityState): EntityRole {
  if (entity.isChild) return 'wanderer';
  const s = entity.skills;
  const entries = (Object.entries(s) as [keyof Skills, number][]);
  const [key, val] = entries.reduce((best, cur) => cur[1] > best[1] ? cur : best, entries[0]);
  if (val < 5) return entity.age > entity.maxAge * 0.70 ? 'elder' : 'wanderer';
  const map: Record<keyof Skills, EntityRole> = {
    hunting: 'hunter', gathering: 'gatherer', farming: 'farmer',
    building: 'builder', crafting: 'crafter', trading: 'merchant', study: 'scholar',
  };
  return map[key] ?? 'wanderer';
}

// ── Genes ─────────────────────────────────────────────────────

export interface Genes {
  strength:     number;
  intelligence: number;
  sociability:  number;
  resilience:   number;
  creativity:   number;
  ambition:     number;
}

// ── Social ────────────────────────────────────────────────────

export interface SocialProfile {
  gender:               Gender;
  orientation:          Orientation | null;
  relationshipStyle:    RelationshipStyle | null;
  partnerIds:           number[];
  affairPartnerIds:     number[];
  friendIds:            number[];
  socialState:          SocialState;
  socialStateTicks:     number;
  dominanceScore:       number;
  followingId:          number | null;
  seekCooldown:         number;
  cheatCooldown:        number;
  ticksAloneFromPartners: number;
  stressTicks:          number;
}

// ── Memory ────────────────────────────────────────────────────

export interface EntityMemory {
  lastFoodTile:   [number, number] | null;
  homeSettlement: [number, number] | null;
  target:         [number, number] | null;
  returning:      boolean;
  ticksSinceFood: number;
}

// ── Animation ─────────────────────────────────────────────────

export interface ActionAnim {
  type:     ActionType;
  /** 0→1 continuous progress driven by wall-clock ms, not tick count */
  progress: number;
  /** How long the animation should play in ms */
  duration: number;
  /** Performance.now() timestamp when the animation started */
  startMs:  number;
}

// ── Entity ────────────────────────────────────────────────────

export interface EntityState {
  id:     number;
  /** Cosmetic role — derived from skills each render frame, not stored permanently */
  type:   EntityRole;
  x:      number;
  y:      number;
  energy: number;
  age:    number;
  maxAge: number;
  genes:  Genes;
  skills: Skills;
  social: SocialProfile;
  settlementId: number;
  tribeId:      number;
  alive:  boolean;
  reproductionCooldown: number;
  memory: EntityMemory;
  carryingFood:         number;
  carryingResource:     number;
  carryingResourceType: 'stone' | 'wood' | 'iron' | null;
  isChild:  boolean;
  parentId: number;
  actionAnim:        ActionAnim;
  buildingProjectId: number;
}

// ── ID counter ────────────────────────────────────────────────

let _nextId = 1;
export function nextEntityId(): number { return _nextId++; }
export function resetEntityIds(): void { _nextId = 1; }

// ── Gene helpers ──────────────────────────────────────────────

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
  const inherit = (a: number, b: number): number =>
    Math.max(0, Math.min(1, (a + b) / 2 + (Math.random() - 0.5) * 2 * ENTITY.MUTATION_RATE));
  return {
    strength:     inherit(parent1.strength,     p2.strength),
    intelligence: inherit(parent1.intelligence, p2.intelligence),
    sociability:  inherit(parent1.sociability,  p2.sociability),
    resilience:   inherit(parent1.resilience,   p2.resilience),
    creativity:   inherit(parent1.creativity,   p2.creativity),
    ambition:     inherit(parent1.ambition,     p2.ambition),
  };
}

/** Children inherit a small fraction of parent skills as a head-start. */
export function inheritSkills(parent1: Skills, parent2?: Skills): Skills {
  const p2 = parent2 ?? parent1;
  const s  = createSkills();
  for (const k of Object.keys(s) as (keyof Skills)[]) {
    s[k] = ((parent1[k] + p2[k]) / 2) * 0.12;
  }
  return s;
}

// ── Social helpers ────────────────────────────────────────────

export function rollOrientation(genes: Genes): Orientation {
  const r = Math.random(), biBonus = genes.sociability * 0.08;
  if (r < 0.08 + biBonus) return 'gay';
  if (r < 0.28 + biBonus) return 'bi';
  return 'straight';
}

export function rollRelationshipStyle(genes: Genes): RelationshipStyle {
  return Math.random() < 0.15 + genes.sociability * 0.12 + genes.creativity * 0.08
    ? 'polyamorous' : 'monogamous';
}

export function isAttractedTo(a: EntityState, b: EntityState): boolean {
  if (!a.social.orientation) return false;
  switch (a.social.orientation) {
    case 'straight': return a.social.gender !== b.social.gender;
    case 'gay':      return a.social.gender === b.social.gender;
    case 'bi':       return true;
  }
}

export function canReproduce(a: EntityState, b: EntityState): boolean {
  return (a.social.gender === 'male'   && b.social.gender === 'female') ||
         (a.social.gender === 'female' && b.social.gender === 'male');
}

// ── Factory ───────────────────────────────────────────────────

export function createEntity(
  _type: EntityRole,
  x: number,
  y: number,
  genes?: Genes,
  skills?: Skills,
): EntityState {
  const g      = genes  ?? createGenes();
  const sk     = skills ?? createSkills();
  const gender: Gender = Math.random() < 0.5 ? 'male' : 'female';
  const maxAge = (7200 + Math.random() * 4800) * (1 + g.resilience * 0.3);

  return {
    id: nextEntityId(),
    type: 'wanderer',
    x, y,
    energy: 0.8 + Math.random() * 0.2,
    age: 0,
    maxAge,
    genes: g,
    skills: sk,
    social: {
      gender,
      orientation:       rollOrientation(g),
      relationshipStyle: rollRelationshipStyle(g),
      partnerIds:        [],
      affairPartnerIds:  [],
      friendIds:         [],
      socialState:       'idle',
      socialStateTicks:  0,
      dominanceScore:    g.strength * 0.4 + g.intelligence * 0.35 + g.ambition * 0.25,
      followingId:       null,
      seekCooldown:      Math.floor(Math.random() * 20),
      cheatCooldown:     0,
      ticksAloneFromPartners: 0,
      stressTicks:       0,
    },
    settlementId: -1,
    tribeId:      -1,
    alive:  true,
    reproductionCooldown: Math.floor(Math.random() * ENTITY.REPRO_COOLDOWN_TICKS),
    memory: {
      lastFoodTile:   null,
      homeSettlement: null,
      target:         null,
      returning:      false,
      ticksSinceFood: 0,
    },
    carryingFood:         0,
    carryingResource:     0,
    carryingResourceType: null,
    isChild:  true,
    parentId: -1,
    actionAnim: { type: null, progress: 0, duration: 800, startMs: 0 },
    buildingProjectId: -1,
  };
}
