// ============================================================
// EVENTS — civilization-focused random and triggered world events.
// ============================================================

import { SimStats } from '../stages/stageDefinitions';
import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';

export type EventSeverity = 'minor' | 'moderate' | 'major' | 'catastrophic';
export type EventCategory = 'environmental' | 'biological' | 'social' | 'divine';

export interface GameEvent {
  id: string;
  name: string;
  description: string;
  severity: EventSeverity;
  category: EventCategory;
  requiredMechanic?: string;
  probability: number;
  cooldownYears: number;
  condition?: (stats: SimStats) => boolean;
  effect: (world: World, em: EntityManager, stats: SimStats) => string;
}

export const GAME_EVENTS: GameEvent[] = [
  // ── Environmental ─────────────────────────────────────
  {
    id: 'bountiful_season',
    name: 'Bountiful Season',
    description: 'The rains come perfectly. Food grows thick across the land.',
    severity: 'minor', category: 'environmental',
    probability: 0.018, cooldownYears: 25,
    effect: (world) => {
      let count = 0;
      for (let y = 0; y < world.rows; y++) {
        for (let x = 0; x < world.cols; x++) {
          const tile = world.getTile(x, y);
          if (!tile) continue;
          const food = tile.resources.find(r => r.type === 'food');
          if (food) { food.amount = Math.min(food.max, food.amount * 1.6); count++; }
        }
      }
      return `Bountiful rains replenished food across ${count} tiles.`;
    },
  },
  {
    id: 'drought',
    name: 'The Long Drought',
    description: 'The sun scorches the earth. Food withers and rivers dry.',
    severity: 'major', category: 'environmental',
    probability: 0.005, cooldownYears: 80,
    effect: (world) => {
      let count = 0;
      for (let y = 0; y < world.rows; y++) {
        for (let x = 0; x < world.cols; x++) {
          const tile = world.getTile(x, y);
          const food = tile?.resources.find(r => r.type === 'food');
          if (food) { food.amount *= 0.25; count++; }
        }
      }
      return `A terrible drought withered food across ${count} tiles.`;
    },
  },
  {
    id: 'volcanic_eruption',
    name: 'Volcanic Eruption',
    description: 'The mountains crack and fire pours forth.',
    severity: 'major', category: 'environmental',
    probability: 0.002, cooldownYears: 400,
    effect: (world, em) => {
      const killed = Math.floor(em.getCount() * (0.06 + Math.random() * 0.1));
      const all = em.getAlive().sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(killed, all.length); i++) {
        all[i].energy = 0; all[i].alive = false;
      }
      // Iron-rich impact zones
      for (let i = 0; i < 4; i++) {
        const tile = world.getRandomPassableTile();
        if (tile) tile.resources.push({ type: 'iron', amount: 10, max: 20, regenRate: 0 });
      }
      return `A volcanic eruption killed ${killed} people and scattered iron across the land.`;
    },
  },
  {
    id: 'great_flood',
    name: 'The Great Flood',
    description: 'The rivers overflow. Low-lying settlements are swallowed.',
    severity: 'catastrophic', category: 'environmental',
    probability: 0.0012, cooldownYears: 600,
    effect: (_world, em) => {
      const killed = Math.floor(em.getCount() * (0.18 + Math.random() * 0.2));
      const all = em.getAlive().sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(killed, all.length); i++) all[i].alive = false;
      return `A great flood swept the lowlands. ${killed} lives lost.`;
    },
  },
  {
    id: 'meteor_shower',
    name: 'Meteor Shower',
    description: 'Streaks of fire cross the night sky. The gods are angry — or generous.',
    severity: 'moderate', category: 'environmental',
    probability: 0.003, cooldownYears: 200,
    effect: (world) => {
      const hits = Math.floor(3 + Math.random() * 5);
      for (let i = 0; i < hits; i++) {
        const tile = world.getRandomPassableTile();
        if (tile) tile.resources.push({ type: 'iron', amount: 12, max: 25, regenRate: 0 });
      }
      return `${hits} meteors struck the earth, leaving iron-rich craters behind.`;
    },
  },

  // ── Biological ──────────────────────────────────────────
  {
    id: 'plague',
    name: 'The Plague',
    description: 'A sickness passes from body to body, taking the weak first.',
    severity: 'catastrophic', category: 'biological',
    requiredMechanic: 'tribes',
    probability: 0.003, cooldownYears: 180,
    condition: (s) => s.totalEntities > 80,
    effect: (_world, em) => {
      const all = em.getAlive();
      let killed = 0;
      for (const e of all) {
        if (e.genes.resilience < 0.4 && Math.random() < 0.5) {
          e.alive = false; killed++;
        }
      }
      return `Plague swept through. ${killed} perished; the resilient survived.`;
    },
  },
  {
    id: 'mutation_burst',
    name: 'Unusual Births',
    description: 'An unusual number of offspring differ wildly from their parents.',
    severity: 'minor', category: 'biological',
    probability: 0.007, cooldownYears: 40,
    effect: (_world, em) => {
      const all = em.getAlive();
      let mutated = 0;
      for (const e of all) {
        if (Math.random() < 0.25) {
          const keys = Object.keys(e.genes) as Array<keyof typeof e.genes>;
          const key = keys[Math.floor(Math.random() * keys.length)];
          (e.genes as any)[key] = Math.max(0, Math.min(1, (e.genes as any)[key] + (Math.random() - 0.5) * 0.25));
          mutated++;
        }
      }
      return `Unusual births affected ${mutated} individuals.`;
    },
  },

  // ── Social ───────────────────────────────────────────────
  {
    id: 'great_migration',
    name: 'Great Migration',
    description: 'A population moves en masse, founding a new colony far away.',
    severity: 'moderate', category: 'social',
    requiredMechanic: 'settlements',
    probability: 0.005, cooldownYears: 120,
    condition: (s) => s.totalEntities > 60,
    effect: (_world, em) => {
      const tribals = em.getAlive().filter(e => e.type !== 'warrior');
      const migrants = tribals.sort(() => Math.random() - 0.5).slice(0, Math.ceil(tribals.length * 0.15));
      for (const m of migrants) {
        // Detach from current settlement — they'll re-settle organically
        m.settlementId = -1;
        m.memory.homeSettlement = null;
        m.memory.returning = false;
      }
      return `${migrants.length} people broke away on a great migration, seeking new lands.`;
    },
  },
  {
    id: 'great_war',
    name: 'The Great War',
    description: 'Rival tribes clash over fertile territory. Rivers run red.',
    severity: 'catastrophic', category: 'social',
    requiredMechanic: 'warfare',
    probability: 0.004, cooldownYears: 250,
    condition: (s) => s.tribesFormed >= 3,
    effect: (_world, em) => {
      const warriors = em.getAlive().filter(e => e.type === 'warrior');
      let killed = 0;
      for (const w of warriors) {
        if (Math.random() < 0.45) { w.alive = false; killed++; }
      }
      // Civilians also suffer
      const civilians = em.getAlive().filter(e => e.type !== 'warrior');
      for (const c of civilians) {
        if (Math.random() < 0.06) { c.alive = false; killed++; }
      }
      return `War devastated the land. ${killed} died in battle and its aftermath.`;
    },
  },
  {
    id: 'cultural_renaissance',
    name: 'Cultural Renaissance',
    description: 'Art, music, and discovery bloom. The spirit of a people rises.',
    severity: 'minor', category: 'social',
    requiredMechanic: 'writing',
    probability: 0.006, cooldownYears: 120,
    effect: (_world, em) => {
      const scholars = em.getAlive().filter(e => e.type === 'scholar' || e.type === 'noble');
      for (const s of scholars) {
        s.genes.intelligence = Math.min(1, s.genes.intelligence + 0.06);
        s.genes.creativity   = Math.min(1, s.genes.creativity   + 0.06);
      }
      return `A cultural renaissance elevated ${scholars.length} scholars and nobles.`;
    },
  },
  {
    id: 'trade_boom',
    name: 'Trade Boom',
    description: 'Merchants grow rich. Cities swell with goods from distant lands.',
    severity: 'minor', category: 'social',
    requiredMechanic: 'trade',
    probability: 0.012, cooldownYears: 60,
    effect: (_world, em) => {
      const merchants = em.getAlive().filter(e => e.type === 'merchant');
      for (const m of merchants) m.energy = Math.min(1, m.energy + 0.35);
      return `A trade boom enriched ${merchants.length} merchants and their settlements.`;
    },
  },

  // ── Divine ───────────────────────────────────────────────
  {
    id: 'divine_miracle',
    name: 'Divine Miracle',
    description: 'The heavens open. The sick are healed; the starving are fed.',
    severity: 'minor', category: 'divine',
    requiredMechanic: 'religion',
    probability: 0.007, cooldownYears: 90,
    effect: (_world, em) => {
      let healed = 0;
      for (const e of em.getAlive()) {
        if (e.energy < 0.4) { e.energy = 0.85; healed++; }
      }
      return `A divine miracle healed and sustained ${healed} souls.`;
    },
  },
  {
    id: 'prophets_arise',
    name: 'Prophets Arise',
    description: 'Wandering prophets unite distant peoples under a new faith.',
    severity: 'moderate', category: 'divine',
    requiredMechanic: 'religion',
    probability: 0.004, cooldownYears: 200,
    condition: (s) => s.tribesFormed >= 4,
    effect: (_world, em) => {
      // Pick a dominant tribe ID and merge smaller ones into it
      const tribeCounts: Record<number, number> = {};
      for (const e of em.getAlive()) {
        if (e.tribeId !== -1) tribeCounts[e.tribeId] = (tribeCounts[e.tribeId] ?? 0) + 1;
      }
      const dominant = parseInt(Object.entries(tribeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-1');
      if (dominant === -1) return 'No tribes to unite.';
      let converted = 0;
      for (const e of em.getAlive()) {
        if (e.tribeId !== dominant && Math.random() < 0.3) {
          e.tribeId = dominant; converted++;
        }
      }
      return `Prophets arose and converted ${converted} people to a shared faith.`;
    },
  },
];
