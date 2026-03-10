export type TileType =
  | 'deep_water'
  | 'shallow_water'
  | 'beach'
  | 'plains'
  | 'forest'
  | 'mountain'
  | 'peak';

export interface TileResource {
  type: 'food' | 'stone' | 'wood' | 'iron' | 'coal';
  amount: number;
  max: number;
  regenRate: number;
}

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  elevation: number;
  fertility: number;
  moisture: number;
  resources: TileResource[];
  occupied: boolean;
  pollution: number;
  claimed: number;
  improvement?: 'farm' | 'mine' | 'settlement' | 'dirt_road' | 'rough_home';
}

export const TILE_COLORS: Record<TileType, string> = {
  deep_water:    '#0a1a3a',
  shallow_water: '#1a3a5a',
  beach:         '#c8b880',
  plains:        '#3a5a2a',
  forest:        '#1a3a1a',
  mountain:      '#5a5a5a',
  peak:          '#c8c8d8',
};

export const TILE_PASSABLE: Record<TileType, boolean> = {
  deep_water:    false,
  shallow_water: false,
  beach:         true,
  plains:        true,
  forest:        true,
  mountain:      false,
  peak:          false,
};

export const TILE_FOOD_VALUE: Record<TileType, number> = {
  deep_water:    0,
  shallow_water: 0.3,
  beach:         0.1,
  plains:        0.8,
  forest:        0.6,
  mountain:      0.1,
  peak:          0,
};
