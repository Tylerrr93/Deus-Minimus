// ============================================================
// GAME CONSTANTS
// ============================================================

export const CANVAS = {
  WIDTH:    1200,
  HEIGHT:   800,
  BG_COLOR: '#0a0a0f',
};

export const WORLD = {
  TILE_SIZE:     8,
  COLS:          150,
  ROWS:          100,
  DEEP_WATER:    0.20,
  SHALLOW_WATER: 0.35,
  BEACH:         0.40,
  PLAINS:        0.60,
  FOREST:        0.75,
  MOUNTAIN:      0.88,
  PEAK:          1.00,
};

export const SIM = {
  BASE_TICK_MS:    500,
  TICKS_PER_YEAR:  120,
  /** How often (in ticks) to run cluster detection for new settlements */
  CLUSTER_CHECK_INTERVAL: 20,
};

export const ENTITY = {
  HUNGER_RATE:             0.0008,
  REPRO_ENERGY_THRESHOLD:  0.55,
  REPRO_COOLDOWN_TICKS:    120,
  VISION_RANGE:            10,
  MUTATION_RATE:           0.04,
  CARRY_CAPACITY:          3.0,
  SPECIALIZE_AGE:          10,
  /** Radius in tiles for detecting a cluster */
  CLUSTER_RADIUS:          8,
  /** Minimum entities in proximity to form a settlement */
  CLUSTER_MIN_SIZE:        5,
};

export const SETTLEMENT = {
  /** Minimum taxi-distance between any two settlement centres */
  MIN_DISTANCE: 18,
  /** Population needed for level 1 → 2 (Campsite → Hamlet) */
  LEVEL2_POP:   8,
  /** Shared food stock needed alongside population for level-up */
  LEVEL2_FOOD:  12,
  /** Population + homes needed for level 2 → 3 (Hamlet → Village) */
  LEVEL3_POP:   16,
  LEVEL3_HOMES: 3,
  /** Max simultaneous active building projects per settlement */
  MAX_ACTIVE_PROJECTS: 3,
  /** Fractional progress added per worker per tick */
  BUILD_RATE: 0.010,
  /** Tiles to search when targeting a road endpoint */
  ROAD_SEARCH_RANGE: 22,
  /** Tiles to search for a home site */
  HOME_SEARCH_RANGE: 6,
  /** Cooldown ticks between spawning new projects */
  PROJECT_COOLDOWN: 40,
  /** Food consumed per population member per tick */
  FOOD_PER_POP_TICK: 0.002,
};

export const GOD = {
  /** Starting favor pool */
  INITIAL_FAVOR:     100,
  /** Hard cap on accumulated favor */
  MAX_FAVOR:         500,
  /** Favor regenerated per simulation tick */
  FAVOR_REGEN_RATE:  0.05,
  /** Multiplier applied when smiting an entity */
  SMITE_RADIUS:      3,
  /** Energy boost applied by Bless Land power */
  BLESS_FOOD_BONUS:  2.0,
  /** Number of entities seeded by Seed Life power */
  SEED_LIFE_COUNT:   5,
  /** Radius of an Apocalypse event in tiles */
  APOCALYPSE_RADIUS: 12,
};
