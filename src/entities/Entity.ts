// ============================================================
// ENTITY — core data types for sentient civilization units.
// ============================================================

import { ENTITY } from '../config/constants';

export type EntityType =
  | 'hunter_gatherer'
  | 'villager'
  | 'farmer'
  | 'craftsman'
  | 'warrior'
  | 'merchant'
  | 'scholar'
  | 'noble';

export type Gender = 'male' | 'female';
export type Orientation = 'straight' | 'gay' | 'bi';
export type RelationshipStyle = 'monogamous' | 'polyamorous';
export type SocialState = 'idle' | 'chatting' | 'relaxing' | 'seeking';

export type ActionType = 'gather' | 'mine' | 'farm' | null;

export interface Genes {
  strength: number;
  intelligence: number;
  sociability: number;
  resilience: number;
  creativity: number;
  ambition: number;
}

export interface SocialProfile {
  gender: Gender;
  orientation: Orientation | null;
  relationshipStyle: RelationshipStyle | null;
  partnerIds: number[];
  affairPartnerIds: number[];
  friendIds: number[];
  socialState: SocialState;
  socialStateTicks: number;
  dominanceScore: number;
  followingId: number | null;
  seekCooldown: number;
  cheatCooldown: number;
  ticksAloneFromPartners: number;
  stressTicks: number;
}

export interface EntityState {
  id: number;
  type: EntityType;
  x: number;
  y: number;
  energy: number;
  age: number;
  maxAge: number;
  genes: Genes;
  social: SocialProfile;
  tribeId: number;
  settlementId: number;
  alive: boolean;
  reproductionCooldown: number;
  memory: EntityMemory;
  carryingFood: number;
  carryingResource: number;
  carryingResourceType: 'stone' | 'wood' | 'iron' | null;
  isChild: boolean;
  parentId: number;
  actionAnim: { type: ActionType; progress: number };
}

export interface EntityMemory {
  lastFoodTile: [number, number] | null;
  homeSettlement: [number, number] | null;
  target: [number, number] | null;
  returning: boolean;
  ticksSinceFood: number;
}

let _nextId = 1;

export function nextEntityId(): number {
  return _nextId++;
}

export function resetEntityIds(): void {
  _nextId = 1;
}

export function createGenes(parent1?: Genes, parent2?: Genes): Genes {
  const base: Genes = {
    strength: 0.4 + (Math.random() - 0.5) * 0.2,
    intelligence: 0.3 + (Math.random() - 0.5) * 0.2,
    sociability: 0.5 + (Math.random() - 0.5) * 0.2,
    resilience: 0.5 + (Math.random() - 0.5) * 0.2,
    creativity: 0.3 + (Math.random() - 0.5) * 0.2,
    ambition: 0.2 + (Math.random() - 0.5) * 0.2,
  };

  if (!parent1) return base;

  const p2 = parent2 ?? parent1;

  const inherit = (a: number, b: number): number => {
    const mid = (a + b) / 2;
    const m = (Math.random() - 0.5) * 2 * ENTITY.MUTATION_RATE;
    return Math.max(0, Math.min(1, mid + m));
  };

  return {
    strength: inherit(parent1.strength, p2.strength),
    intelligence: inherit(parent1.intelligence, p2.intelligence),
    sociability: inherit(parent1.sociability, p2.sociability),
    resilience: inherit(parent1.resilience, p2.resilience),
    creativity: inherit(parent1.creativity, p2.creativity),
    ambition: inherit(parent1.ambition, p2.ambition),
  };
}

export function rollOrientation(genes: Genes): Orientation {
  const r = Math.random();
  const biBonus = genes.sociability * 0.08;

  if (r < 0.08 + biBonus) return 'gay';
  if (r < 0.28 + biBonus) return 'bi';

  return 'straight';
}

export function rollRelationshipStyle(genes: Genes): RelationshipStyle {
  const poly = 0.15 + genes.sociability * 0.12 + genes.creativity * 0.08;
  return Math.random() < poly ? 'polyamorous' : 'monogamous';
}

export function isAttractedTo(a: EntityState, b: EntityState): boolean {
  if (!a.social.orientation) return false;

  const ag = a.social.gender;
  const bg = b.social.gender;

  switch (a.social.orientation) {
    case 'straight':
      return ag !== bg;
    case 'gay':
      return ag === bg;
    case 'bi':
      return true;
  }
}

export function canReproduce(a: EntityState, b: EntityState): boolean {
  return (
    (a.social.gender === 'male' && b.social.gender === 'female') ||
    (a.social.gender === 'female' && b.social.gender === 'male')
  );
}

export function createEntity(
  type: EntityType,
  x: number,
  y: number,
  genes?: Genes,
  tribeId: number = -1,
): EntityState {
  const g = genes ?? createGenes();
  const gender: Gender = Math.random() < 0.5 ? 'male' : 'female';

  return {
    id: nextEntityId(),
    type,
    x,
    y,

    energy: 0.8 + Math.random() * 0.2,
    age: 0,

    maxAge: (800 + Math.random() * 600) * (1 + g.resilience * 0.4),
    
    genes: g,

    social: {
      gender,

      // ⭐ FIX: Give orientation at birth
      orientation: rollOrientation(g),

      // ⭐ FIX: Give relationship style at birth
      relationshipStyle: rollRelationshipStyle(g),

      partnerIds: [],
      affairPartnerIds: [],
      friendIds: [],

      socialState: 'idle',
      socialStateTicks: 0,

      dominanceScore:
        g.strength * 0.4 +
        g.intelligence * 0.35 +
        g.ambition * 0.25,

      followingId: null,
      seekCooldown: Math.floor(Math.random() * 20),
      cheatCooldown: 0,
      ticksAloneFromPartners: 0,
      stressTicks: 0,
    },

    tribeId,
    settlementId: -1,

    alive: true,

    reproductionCooldown:
      Math.floor(Math.random() * ENTITY.REPRO_COOLDOWN_TICKS),

    memory: {
      lastFoodTile: null,
      homeSettlement: null,
      target: null,
      returning: false,
      ticksSinceFood: 0,
    },

    carryingFood: 0,
    carryingResource: 0,
    carryingResourceType: null,

    isChild: true,
    parentId: -1,

    actionAnim: { type: null, progress: 0 },
  };
}