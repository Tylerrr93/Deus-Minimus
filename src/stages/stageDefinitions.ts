// ============================================================
// STAGE DEFINITIONS — Eras of civilization.
// The primordial / cellular / creature stages are removed.
// Civilization begins at DAWN_OF_SAPIENCE and grows from there.
// ============================================================

export type StageId =
  | 'DAWN_OF_SAPIENCE'
  | 'TRIBAL_AGE'
  | 'VILLAGE_AGE'
  | 'BRONZE_AGE'
  | 'IRON_AGE'
  | 'CLASSICAL_AGE'
  | 'MEDIEVAL_AGE'
  | 'RENAISSANCE'
  | 'INDUSTRIAL_AGE';

export interface StageDefinition {
  id: StageId;
  name: string;
  description: string;
  unlockCondition: (stats: SimStats) => boolean;
  onEnter?: (world: any, entityManager: any, settlements: any) => void;
  mechanics: string[];
  bgTint: string;
  musicMood: string;
}

export interface SimStats {
  totalEntities:      number;
  totalYears:         number;
  totalDeaths:        number;
  totalBirths:        number;
  highestPopulation:  number;
  resourcesExtracted: number;
  tribesFormed:       number;
  settlementsBuilt:   number;
  techDiscovered:     number;
  stage:              StageId;
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    id: 'DAWN_OF_SAPIENCE',
    name: 'Dawn of Sapience',
    description: 'Hunter-gatherers roam a wild world. Fire, language, and the first tools are yet to come.',
    unlockCondition: () => true,
    mechanics: ['hunger', 'reproduction', 'death', 'hunting'],
    bgTint: '#140d00',
    musicMood: 'ambient_deep',
  },
  {
    id: 'TRIBAL_AGE',
    name: 'Age of Tribes',
    description: 'Bands of kin share fire and stories. Identity is forged through shared struggle.',
    unlockCondition: (s) => s.tribesFormed >= 2 && s.totalYears >= 60,
    onEnter: (world, em) => {
      // Upgrade some hunter_gatherers to reflect tribal sophistication
      const all = em.getAlive().filter((e: any) => e.type === 'hunter_gatherer');
      for (const e of all.slice(0, Math.min(5, all.length))) {
        e.genes.sociability = Math.min(1, e.genes.sociability + 0.15);
      }
    },
    mechanics: ['tribes', 'basic_tools', 'fire', 'language'],
    bgTint: '#1a1000',
    musicMood: 'tribal_drums',
  },
  {
    id: 'VILLAGE_AGE',
    name: 'Age of Villages',
    description: 'Permanent settlements rise. Food is stored, not just found. The world grows smaller.',
    unlockCondition: (s) => s.settlementsBuilt >= 3 && s.tribesFormed >= 3,
    onEnter: (_world, _em, settlements) => {
      // All existing settlements are now tracked
      for (const s of settlements.getAll()) {
        s.level = Math.max(s.level, 2);
      }
    },
    mechanics: ['settlements', 'farming', 'trade', 'pottery', 'roads'],
    bgTint: '#1a1500',
    musicMood: 'ancient_strings',
  },
  {
    id: 'BRONZE_AGE',
    name: 'Bronze Age',
    description: 'Metal tools reshape labor. City-states rise. War becomes organized.',
    unlockCondition: (s) => s.techDiscovered >= 4 && s.settlementsBuilt >= 6,
    mechanics: ['metallurgy', 'warfare', 'writing', 'religion', 'city_states'],
    bgTint: '#1a1200',
    musicMood: 'ancient_brass',
  },
  {
    id: 'IRON_AGE',
    name: 'Iron Age',
    description: 'Iron replaces bronze. Empires stretch across continents. The age of conquest begins.',
    unlockCondition: (s) => s.resourcesExtracted >= 500 && s.techDiscovered >= 8,
    mechanics: ['iron_working', 'conquest', 'governance', 'monuments', 'philosophy'],
    bgTint: '#150800',
    musicMood: 'epic_tension',
  },
  {
    id: 'CLASSICAL_AGE',
    name: 'Classical Age',
    description: 'Philosophy, law, and art flourish. Great cities become centres of the world.',
    unlockCondition: (s) => s.techDiscovered >= 14 && s.settlementsBuilt >= 12,
    mechanics: ['democracy', 'libraries', 'aqueducts', 'legions', 'coinage'],
    bgTint: '#0d0d18',
    musicMood: 'classical_strings',
  },
  {
    id: 'MEDIEVAL_AGE',
    name: 'Medieval Age',
    description: 'Kingdoms and castles. Plague and faith. The old empire has fallen.',
    unlockCondition: (s) => s.techDiscovered >= 22 && s.settlementsBuilt >= 18,
    mechanics: ['feudalism', 'castles', 'plague', 'guilds', 'crusades'],
    bgTint: '#0f0f1a',
    musicMood: 'medieval_choir',
  },
  {
    id: 'RENAISSANCE',
    name: 'The Renaissance',
    description: 'Art, science, and exploration surge. New worlds are within reach.',
    unlockCondition: (s) => s.techDiscovered >= 32 && s.totalYears >= 5000,
    mechanics: ['printing_press', 'exploration', 'banking', 'astronomy', 'art_patronage'],
    bgTint: '#121820',
    musicMood: 'renaissance_lute',
  },
  {
    id: 'INDUSTRIAL_AGE',
    name: 'Industrial Revolution',
    description: 'Steam and coal devour the old world. Smoke rises over ancient forests.',
    unlockCondition: (s) => s.techDiscovered >= 45 && s.totalYears >= 9000,
    mechanics: ['factories', 'rail', 'pollution', 'class_struggle', 'nationalism'],
    bgTint: '#1a1010',
    musicMood: 'industrial_drone',
  },
];
