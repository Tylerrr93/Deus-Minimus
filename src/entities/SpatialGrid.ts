// ============================================================
// SPATIAL GRID — O(1) approximate neighbor lookup.
// Replaces the O(n²) linear scan that caused lag at high entity counts.
// Divides world tiles into coarse grid cells; entities register in their cell.
// A range query only checks the small number of cells that overlap the radius.
// ============================================================

export class SpatialGrid {
  // cellKey -> array of entity IDs that live in that grid cell
  private cells: Map<number, number[]> = new Map();
  // entityId -> cellKey (so we know which cell to remove from on move)
  private entityCell: Map<number, number> = new Map();

  private readonly gridCols: number;

  constructor(
    private readonly worldCols: number,
    worldRows: number,
    // How many world-tiles wide each grid cell is.
    // Larger = fewer cells, cheaper queries but more false positives.
    // 8 is a good balance for a 150×100 world.
    private readonly cellSize: number = 8,
  ) {
    this.gridCols = Math.ceil(worldCols / cellSize);
    void worldRows; // stored only for documentation
  }

  private key(cx: number, cy: number): number {
    return cy * this.gridCols + cx;
  }

  private tileToCell(tx: number, ty: number): [number, number] {
    return [
      Math.floor(tx / this.cellSize),
      Math.floor(ty / this.cellSize),
    ];
  }

  insert(id: number, x: number, y: number): void {
    const [cx, cy] = this.tileToCell(x, y);
    const k = this.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) { cell = []; this.cells.set(k, cell); }
    cell.push(id);
    this.entityCell.set(id, k);
  }

  remove(id: number, x: number, y: number): void {
    const [cx, cy] = this.tileToCell(x, y);
    const k = this.key(cx, cy);
    const cell = this.cells.get(k);
    if (cell) {
      const idx = cell.indexOf(id);
      if (idx !== -1) {
        // Swap-remove for O(1) deletion
        cell[idx] = cell[cell.length - 1];
        cell.pop();
      }
    }
    this.entityCell.delete(id);
  }

  /** Call when an entity moves from (ox,oy) to (nx,ny). Only updates cell if grid-cell changed. */
  move(id: number, ox: number, oy: number, nx: number, ny: number): void {
    const [ocx, ocy] = this.tileToCell(ox, oy);
    const [ncx, ncy] = this.tileToCell(nx, ny);
    if (ocx === ncx && ocy === ncy) return; // same cell, nothing to do
    this.remove(id, ox, oy);
    this.insert(id, nx, ny);
  }

  /** Returns entity IDs whose grid cell overlaps the query radius. May include false positives. */
  query(x: number, y: number, range: number): number[] {
    const result: number[] = [];
    const gridRange = Math.ceil(range / this.cellSize) + 1;
    const [cx, cy] = this.tileToCell(x, y);

    for (let dy = -gridRange; dy <= gridRange; dy++) {
      for (let dx = -gridRange; dx <= gridRange; dx++) {
        const k = this.key(cx + dx, cy + dy);
        const cell = this.cells.get(k);
        if (cell) {
          for (const id of cell) result.push(id);
        }
      }
    }
    return result;
  }

  clear(): void {
    this.cells.clear();
    this.entityCell.clear();
  }
}
