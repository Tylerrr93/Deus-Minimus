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
  /**
   * Hunger drained per tick. At 120 ticks/year an entity at full energy
   * would survive ~83 years unfed — realistic for a human lifespan.
   * Previous value (0.0008) caused starvation in ~10 years.
   */
  HUNGER_RATE:             0.00010,

  /**
   * Minimum energy to attempt reproduction.
   * Lowered from 0.55 so well-fed but not peak-energy entities can still breed.
   */
  REPRO_ENERGY_THRESHOLD:  0.45,

  /**
   * Cooldown between births in ticks.
   * 120 ticks = 1 in-game year — roughly equivalent to a human birth interval.
   */
  REPRO_COOLDOWN_TICKS:    120,

  VISION_RANGE:            10,
  MUTATION_RATE:           0.04,
  CARRY_CAPACITY:          3.0,

  /**
   * Ticks before a child becomes an adult.
   * 240 ticks = 2 in-game years — short enough that children don't starve
   * waiting, long enough to be meaningful.
   */
  SPECIALIZE_AGE:          240,

  /** Radius in tiles for detecting a cluster */
  CLUSTER_RADIUS:          8,

  /**
   * Minimum adults in proximity to form a settlement.
   * Lowered from 5 → 3 so early small bands can settle.
   */
  CLUSTER_MIN_SIZE:        3,
};

export const SETTLEMENT = {
  /** Minimum taxi-distance between any two settlement centres */
  MIN_DISTANCE: 18,
  /** Population needed for level 1 → 2 (Campsite → Hamlet) */
  LEVEL2_POP:   6,
  /** Shared food stock needed alongside population for level-up */
  LEVEL2_FOOD:  8,
  /** Population + homes needed for level 2 → 3 (Hamlet → Village) */
  LEVEL3_POP:   12,
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
  /**
   * Food consumed per population member per tick.
   * Scaled down to match the new hunger rate — keeps settlement food
   * stores from draining impossibly fast.
   */
  FOOD_PER_POP_TICK: 0.0002,
};
