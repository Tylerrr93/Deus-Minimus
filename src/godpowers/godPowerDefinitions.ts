// ============================================================
// GOD POWERS — what the player can do.
// Philosophy: the player is a subtle overseer, not a puppeteer.
// Powers primarily unlock possibilities, inspire discovery, or
// tip the scales — rather than directly constructing things.
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { SettlementManager } from '../entities/SettlementManager';
import { SimStats } from '../stages/stageDefinitions';

export interface GodPower {
  id: string;
  name: string;
  description: string;
  icon: string;
  favorCost: number;
  cooldownYears: number;
  requiredMechanic?: string;
  targetType: 'tile' | 'entity' | 'world' | 'position';
  execute: (
    world: World,
    em: EntityManager,
    settlements: SettlementManager,
    stats: SimStats,
    target?: { x: number; y: number }
  ) => string;
}

export const GOD_POWERS: GodPower[] = [
  // ── Nurture / Growth ──────────────────────────────────────
  {
    id: 'bless_land',
    name: 'Bless the Land',
    description: 'Flood a region with food and fertility — attracting gatherers and accelerating growth.',
    icon: '✦',
    favorCost: 20, cooldownYears: 10,
    targetType: 'tile',
    execute: (_world, _em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const tile = _world.getTile(target.x, target.y);
      if (!tile) return 'Invalid tile.';
      let food = tile.resources.find(r => r.type === 'food');
      if (!food) { food = { type: 'food', amount: 0, max: 12, regenRate: 0.025 }; tile.resources.push(food); }
      food.amount = food.max;
      food.regenRate = Math.min(0.05, food.regenRate * 2.2);
      return `Blessed land at (${target.x}, ${target.y}). Abundance spreads.`;
    },
  },
  {
    id: 'inspire',
    name: 'Inspire',
    description: 'Fill nearby people with divine energy and purpose. Boosts reproduction and activity.',
    icon: '◈',
    favorCost: 35, cooldownYears: 12,
    targetType: 'position',
    execute: (_world, em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const near = em.getAlive().filter(e =>
        Math.abs(e.x - target.x) <= 6 && Math.abs(e.y - target.y) <= 6
      );
      for (const e of near) {
        e.energy = Math.min(1, e.energy + 0.45);
        e.reproductionCooldown = Math.max(0, e.reproductionCooldown - 30);
      }
      return `Inspired ${near.length} people with divine energy.`;
    },
  },
  {
    id: 'reveal_bounty',
    name: 'Reveal Bounty',
    description: 'Hidden ore and fertile ground are revealed to nearby units. Seeds the discovery of resources.',
    icon: '◉',
    favorCost: 45, cooldownYears: 20,
    targetType: 'position',
    execute: (world, em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const range = 10;
      let revealed = 0;
      for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) {
          const t = world.getTile(target.x + dx, target.y + dy);
          if (!t) continue;
          if (t.type === 'mountain' && t.resources.length === 0) {
            const rng = Math.random();
            if (rng < 0.4) t.resources.push({ type: 'stone', amount: 15, max: 30, regenRate: 0 });
            else if (rng < 0.7) t.resources.push({ type: 'iron', amount: 8, max: 20, regenRate: 0 });
            revealed++;
          }
        }
      }
      // Point nearby craftsmen toward the area
      const craftsmen = em.getAlive().filter(e =>
        (e.type === 'craftsman' || e.type === 'villager') &&
        Math.abs(e.x - target.x) <= 20 && Math.abs(e.y - target.y) <= 20
      );
      for (const c of craftsmen) {
        c.memory.target = [target.x + Math.floor((Math.random() - 0.5) * 8),
                           target.y + Math.floor((Math.random() - 0.5) * 8)];
      }
      return `Revealed ${revealed} resource deposits. ${craftsmen.length} craftsmen take notice.`;
    },
  },

  // ── Technology unlock ────────────────────────────────────
  {
    id: 'divine_vision',
    name: 'Divine Vision',
    description: 'A chosen individual gains a sudden flash of insight — accelerating their settlement\'s tech.',
    icon: '◬',
    favorCost: 60, cooldownYears: 18,
    requiredMechanic: 'basic_tools',
    targetType: 'position',
    execute: (_world, em, settlements, _stats, target) => {
      if (!target) return 'No target.';
      const near = em.getAlive().filter(e =>
        Math.abs(e.x - target.x) <= 4 && Math.abs(e.y - target.y) <= 4 &&
        e.settlementId !== -1
      );
      if (near.length === 0) return 'No one nearby to inspire.';
      const chosen = near.sort((a, b) => b.genes.intelligence - a.genes.intelligence)[0];
      chosen.genes.intelligence = Math.min(1, chosen.genes.intelligence + 0.2);
      chosen.genes.creativity   = Math.min(1, chosen.genes.creativity   + 0.15);
      const s = settlements.getById(chosen.settlementId);
      if (s) s.techPoints += 12;
      return `Divine vision touched ${chosen.type} #${chosen.id}. Their settlement gains insight.`;
    },
  },
  {
    id: 'gift_fire',
    name: 'Gift of Fire',
    description: 'Teach a cluster of hunter-gatherers the mastery of fire — accelerating tribal formation.',
    icon: '🔥',
    favorCost: 70, cooldownYears: 50,
    requiredMechanic: 'fire',
    targetType: 'position',
    execute: (_world, em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const near = em.getAlive().filter(e =>
        e.type === 'hunter_gatherer' &&
        Math.abs(e.x - target.x) <= 5 && Math.abs(e.y - target.y) <= 5
      );
      for (const e of near) {
        e.genes.intelligence = Math.min(1, e.genes.intelligence + 0.15);
        e.genes.sociability  = Math.min(1, e.genes.sociability  + 0.2);
      }
      return `Gifted fire to ${near.length} hunter-gatherers. They begin to bond.`;
    },
  },
  {
    id: 'great_omen',
    name: 'Great Omen',
    description: 'A sign in the sky unites scattered people under a shared identity.',
    icon: '★',
    favorCost: 90, cooldownYears: 70,
    requiredMechanic: 'language',
    targetType: 'world',
    execute: (_world, em, _s, _stats) => {
      // Merge the two largest tribes, or group ungrouped into a new tribe
      const counts: Record<number, number> = {};
      for (const e of em.getAlive()) {
        if (e.tribeId !== -1) counts[e.tribeId] = (counts[e.tribeId] ?? 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const newId = Date.now() % 100000;
      let united = 0;
      for (const e of em.getAlive()) {
        if (e.tribeId === -1 && Math.random() < 0.5) { e.tribeId = newId; united++; }
        else if (sorted.length >= 2 && e.tribeId === parseInt(sorted[1][0]) && Math.random() < 0.4) {
          e.tribeId = parseInt(sorted[0][0]); united++;
        }
      }
      return `A great omen in the sky united ${united} wanderers and outcasts.`;
    },
  },

  // ── Infrastructure ───────────────────────────────────────
  {
    id: 'seed_settlement',
    name: 'Seed of Civilization',
    description: 'Found a new camp near this location — beginning a new civilization hub.',
    icon: '⌂',
    favorCost: 100, cooldownYears: 60,
    requiredMechanic: 'settlements',
    targetType: 'position',
    execute: (world, em, settlements, _stats, target) => {
      if (!target) return 'No target.';
      const tile = world.findPassableTileNear(target.x, target.y, 8);
      if (!tile) return 'No suitable land found.';
      // Pick or assign a tribe ID
      const nearby = em.getAlive().filter(e =>
        Math.abs(e.x - target.x) <= 15 && e.tribeId !== -1
      );
      const tribeId = nearby.length > 0
        ? nearby[0].tribeId
        : Math.floor(Date.now() % 100000);

      const s = settlements.found(tile.x, tile.y, tribeId);
      if (!s) return 'Location too close to an existing settlement.';

      // Assign closest units to it
      const candidates = em.getAlive()
        .filter(e => e.settlementId === -1)
        .sort((a, b) =>
          Math.abs(a.x - s.x) + Math.abs(a.y - s.y) -
          (Math.abs(b.x - s.x) + Math.abs(b.y - s.y))
        );
      for (const c of candidates.slice(0, 6)) {
        em.assignToSettlement(c, s.id);
      }
      return `Founded ${s.name} — ${candidates.slice(0, 6).length} settlers answer the call.`;
    },
  },
  {
    id: 'raise_mountain',
    name: 'Raise Mountain',
    description: 'Reshape the earth — push a tile into mountainous terrain, rich with minerals.',
    icon: '▲',
    favorCost: 110, cooldownYears: 100,
    targetType: 'tile',
    execute: (world, _em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const tile = world.getTile(target.x, target.y);
      if (!tile) return 'Invalid tile.';
      tile.type = 'mountain';
      tile.elevation = 0.92;
      tile.resources = [
        { type: 'stone', amount: 20, max: 30, regenRate: 0 },
        { type: 'iron',  amount: 8,  max: 20, regenRate: 0 },
      ];
      return `A mountain rose at (${target.x}, ${target.y}). Stone and iron await the brave.`;
    },
  },

  // ── Judgment ─────────────────────────────────────────────
  {
    id: 'smite',
    name: 'Smite',
    description: 'Call down divine lightning on an area — killing those nearby.',
    icon: '⚡',
    favorCost: 25, cooldownYears: 5,
    targetType: 'position',
    execute: (_world, em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const struck = em.getAlive().filter(e =>
        Math.abs(e.x - target.x) <= 2 && Math.abs(e.y - target.y) <= 2
      );
      for (const e of struck) e.alive = false;
      return `Divine lightning struck (${target.x}, ${target.y}). ${struck.length} perished.`;
    },
  },
  {
    id: 'pestilence',
    name: 'Pestilence',
    description: 'Unleash a targeted plague — killing the weak and sparing the resilient.',
    icon: '☣',
    favorCost: 55, cooldownYears: 30,
    targetType: 'position',
    execute: (_world, em, _s, _stats, target) => {
      if (!target) return 'No target.';
      const near = em.getAlive().filter(e =>
        Math.abs(e.x - target.x) <= 10 && Math.abs(e.y - target.y) <= 10
      );
      let killed = 0;
      for (const e of near) {
        if (e.genes.resilience < 0.5 && Math.random() < 0.65) { e.alive = false; killed++; }
      }
      return `Pestilence claimed ${killed} lives. The resilient endure.`;
    },
  },
  {
    id: 'apocalypse',
    name: 'Apocalypse',
    description: 'Burn it all down. A great reset. Only the strongest survive.',
    icon: '☠',
    favorCost: 200, cooldownYears: 9999,
    targetType: 'world',
    execute: (_world, em, _s, _stats) => {
      let killed = 0;
      for (const e of em.getAlive()) {
        if (Math.random() < 0.88) { e.alive = false; killed++; }
      }
      return `The apocalypse has come. ${killed} souls lost. The survivors inherit ashes.`;
    },
  },
];
