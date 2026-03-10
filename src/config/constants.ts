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
  // World gen noise thresholds
  DEEP_WATER:    0.20,
  SHALLOW_WATER: 0.35,
  BEACH:         0.40,
  PLAINS:        0.60,
  FOREST:        0.75,
  MOUNTAIN:      0.88,
  PEAK:          1.00,
};

export const SIM = {
  BASE_TICK_MS:    100,   // ms per sim tick
  TICKS_PER_YEAR:  200,  // display "years" pass this often
};

export const GOD = {
  INITIAL_FAVOR:      100,
  MAX_FAVOR:          300,
  FAVOR_REGEN_PER_TICK: 0.05,
};

export const ENTITY = {
  MAX_AGE_VARIANCE:        0.3,
  HUNGER_RATE:             0.0015, 
  MOVE_ENERGY_COST:        0.0003,
  REPRO_ENERGY_THRESHOLD:  0.7,
  REPRO_COOLDOWN_TICKS:    150,
  VISION_RANGE:            10,
  MUTATION_RATE:           0.04,
  CARRY_CAPACITY:          3.0,     // max food a single unit can carry
  TRIBE_BOND_RADIUS:       10,      // tiles within which tribe-bonding can occur
  SETTLEMENT_FOUND_RADIUS: 5,       // tiles a founder searches for a good spot
  SPECIALIZE_AGE:          20,      // minimum age before a unit can specialize
};
