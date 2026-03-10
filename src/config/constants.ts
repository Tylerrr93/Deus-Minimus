// ============================================================
// GAME CONSTANTS — edit freely to tune simulation feel
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
  BASE_TICK_MS:    500,  // ms per sim tick — slow enough to observe events
  TICKS_PER_YEAR:  120,  // years advance at this cadence (100 ticks = ~25s real time)
};

export const GOD = {
  INITIAL_FAVOR:      100,
  MAX_FAVOR:          300,
  FAVOR_REGEN_PER_TICK: 0.05,
};

export const ENTITY = {
  MAX_AGE_VARIANCE:        0.3,
  HUNGER_RATE:             0.0008,   // slow drain — entities stay fed comfortably
  MOVE_ENERGY_COST:        0.0002,   // cheap movement
  REPRO_ENERGY_THRESHOLD:  0.55,     // achievable even when not perfectly topped off
  REPRO_COOLDOWN_TICKS:    120,       // several births possible per lifespan
  VISION_RANGE:            10,       // used for neighbour query radius
  MUTATION_RATE:           0.04,
  CARRY_CAPACITY:          3.0,
  TRIBE_BOND_RADIUS:       10,
  SETTLEMENT_FOUND_RADIUS: 5,
  SPECIALIZE_AGE:          10,       // adulthood comes quickly
};
