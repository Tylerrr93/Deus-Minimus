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
  /**
   * How often (in ticks) the Settlement Brain recalculates need scores
   * and reassigns entity tasks. Prime so it never syncs with cluster check.
   */
  NEEDS_RECALC_INTERVAL: 17,
};

export const ENTITY = {
  /** Hunger drained per tick. */
  HUNGER_RATE:             0.00018,   
  /** Minimum energy to attempt reproduction. */
  REPRO_ENERGY_THRESHOLD:  0.45,
  /** Cooldown between births in ticks. 120 ticks = 1 in-game year. */
  REPRO_COOLDOWN_TICKS:    120,
  VISION_RANGE:            10,
  MUTATION_RATE:           0.04,
  CARRY_CAPACITY:          3.0,
  /** Ticks before a child becomes an adult. */
  SPECIALIZE_AGE:          240,
  /** Radius in tiles for detecting a cluster */
  CLUSTER_RADIUS:          8,
  /** Minimum adults in proximity to form a settlement. */
  CLUSTER_MIN_SIZE:        3,
  /**
   * Energy cost per tile moved.
   */
  MOVE_ENERGY_COST:        0.0015,

  // ── Reproduction economic gates ──────────────────────────

  /** Settlement foodStorage must exceed (population × REPRO_FOOD_PER_CAP). */
  REPRO_FOOD_PER_CAP:      1.5,       // ↓ from 2.0 — slightly easier to reproduce
  /** Nomad entities: minimum energy before they may reproduce. */
  REPRO_NOMAD_ENERGY:      0.70,

  // ── Housing limit ────────────────────────────────────────

  /** How many entities a single rough_home can shelter. */
  SHELTER_PER_HOME:        4,
  /** Base shelter capacity before any homes are built (open campsite). */
  SHELTER_BASE:            8,

  // ── Leash ────────────────────────────────────────────────

  /**
   * Max tile distance a settled entity will wander from their settlement
   * centre before territorial wander pulls them back.
   * Reduced from the implicit 20 to keep settlers near home.
   */
  LEASH_RADIUS:            12,
};

export const SETTLEMENT = {
  /** Minimum taxi-distance between any two settlement centres */
  MIN_DISTANCE: 18,
  /** Population needed for level 1 → 2 */
  LEVEL2_POP:   5,             // ↓ from 6 — easier first upgrade
  LEVEL2_FOOD:  6,             // ↓ from 8
  /** Population + homes needed for level 2 → 3 */
  LEVEL3_POP:   12,
  LEVEL3_HOMES: 3,
  MAX_ACTIVE_PROJECTS: 3,
  BUILD_RATE: 0.012,           // ↑ from 0.010 — slightly faster construction
  ROAD_SEARCH_RANGE: 22,
  HOME_SEARCH_RANGE: 6,
  PROJECT_COOLDOWN: 30,        // ↓ from 40 — projects queue up sooner
  FOOD_PER_POP_TICK: 0.0004,  // ↑ from 0.0002 — settlements consume food faster
  CHILD_ERRAND_RADIUS: 4,

  // ── Needs Matrix thresholds ───────────────────────────────

  /**
   * When Food Need > this value ALL available adult settlers
   * drop their current task and switch to 'gather'.
   */
  CRISIS_FOOD_NEED:        0.75,      // ↓ from 0.80 — crisis kicks in a bit sooner

  /**
   * Below this Food Need, gatherers are released to switch to
   * 'wood' or 'build' tasks based on other need scores.
   */
  IDLE_FOOD_NEED:          0.30,      // ↓ from 0.40 — workers freed sooner for building

  /**
   * Wood need target for active construction.
   */
  WOOD_NEED_BUILD_TARGET:  20,

  // ── Agriculture (Agrarian Shift) ──────────────────────────

  AGRI_TECH_THRESHOLD:     40,
  AGRI_FARM_SLOTS_PER_LVL: 3,
  AGRI_SEARCH_RADIUS:      14,
  AGRI_REGEN_MULTIPLIER:   4.0,
  AGRI_FOOD_CAP:           20,
  AGRI_HARVEST_AMOUNT:     0.8,
};