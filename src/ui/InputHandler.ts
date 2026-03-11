import { Camera } from './Renderer';
import { CANVAS, WORLD } from '../config/constants';
import { EntityManager } from '../entities/EntityManager';
import { EntityState } from '../entities/Entity';

export class InputHandler {
  private keys: Set<string> = new Set();
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private cameraStart = { x: 0, y: 0 };
  private dragDistance = 0;

  // --- NEW PROPERTIES FOR CYCLING ---
  private lastClickWorld = { x: 0, y: 0 };
  private clickCycleIndex = 0;
  // ----------------------------------

  private _hoveredTile: { x: number; y: number } | null = null;
  private _clickedTile: { x: number; y: number } | null = null;

  private em: EntityManager | null = null;

  onTileClick?: (tile: { x: number; y: number }) => void;
  onEntityClick?: (entity: EntityState) => void;
  onEmptyClick?: () => void;

  setEntityManager(em: EntityManager): void {
    this.em = em;
  }

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    this.bind();
  }

  private bind(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.keys.add(e.key));
    window.addEventListener('keyup', e => this.keys.delete(e.key));
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const wx = (sx - this.camera.x) / this.camera.zoom;
    const wy = (sy - this.camera.y) / this.camera.zoom;
    return { x: wx, y: wy };
  }

  private worldToTile(wx: number, wy: number): { x: number; y: number } {
    return {
      x: Math.floor(wx / WORLD.TILE_SIZE),
      y: Math.floor(wy / WORLD.TILE_SIZE),
    };
  }

  private getEventPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { 
      x: (e.clientX - rect.left) * scaleX, 
      y: (e.clientY - rect.top) * scaleY 
    };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) {
      this.dragDistance = 0;
      this.isDragging = true;
      const pos = this.getEventPos(e);
      this.dragStart = pos;
      this.cameraStart = { x: this.camera.x, y: this.camera.y };
    }
    if (e.button === 2 || e.button === 1) {
      this.isDragging = true;
      const pos = this.getEventPos(e);
      this.dragStart = pos;
      this.cameraStart = { x: this.camera.x, y: this.camera.y };
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const pos = this.getEventPos(e);
    const world = this.screenToWorld(pos.x, pos.y);
    this._hoveredTile = this.worldToTile(world.x, world.y);

    if (this.isDragging) {
      const dx = pos.x - this.dragStart.x;
      const dy = pos.y - this.dragStart.y;
      this.dragDistance += Math.hypot(dx - (this.camera.x - this.cameraStart.x),
                                       dy - (this.camera.y - this.cameraStart.y));
      this.camera.x = this.cameraStart.x + dx;
      this.camera.y = this.cameraStart.y + dy;
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.isDragging = false;
      if (this.dragDistance < 5) {
        const pos = this.getEventPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        const tile = this.worldToTile(world.x, world.y);
        this._clickedTile = tile;

        // --- NEW CYCLING LOGIC ---
        // Check if this click is close enough to the last click to count as a cycle
        const distToLast = Math.hypot(world.x - this.lastClickWorld.x, world.y - this.lastClickWorld.y);
        if (distToLast < WORLD.TILE_SIZE * 0.5) {
          this.clickCycleIndex++;
        } else {
          this.clickCycleIndex = 0;
          this.lastClickWorld = world; // Only update location if we started a new click spot
        }

        const selectables: any[] = [];
        
        // 1. Gather all entities in radius
        if (this.em) {
          const ts = WORLD.TILE_SIZE;
          const pickRadius = ts * 1.2;
          const hitEntities: { dist: number, entity: EntityState }[] = [];
          
          this.em.forEachAlive(e => {
            const ex = e.x * ts + ts * 0.5;
            const ey = e.y * ts + ts * 0.5;
            const dist = Math.hypot(world.x - ex, world.y - ey);
            if (dist < pickRadius) hitEntities.push({ dist, entity: e });
          });
          
          // Sort entities from closest to furthest
          hitEntities.sort((a, b) => a.dist - b.dist);
          selectables.push(...hitEntities.map(h => h.entity));
        }

        // 2. Add the base tile to the end of the array (bottom layer)
        selectables.push(tile);

        // 3. Select based on current cycle index
        const selected = selectables[this.clickCycleIndex % selectables.length];

        if ('id' in selected) {
          this.onEntityClick?.(selected as EntityState);
        } else {
          this.onTileClick?.(selected as { x: number; y: number });
        }
        // -------------------------
      }
      this.dragDistance = 0;
    }
    if (e.button === 2 || e.button === 1) this.isDragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pos = this.getEventPos(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.5, Math.min(8, this.camera.zoom * zoomFactor));

    const wx = (pos.x - this.camera.x) / this.camera.zoom;
    const wy = (pos.y - this.camera.y) / this.camera.zoom;
    this.camera.x = pos.x - wx * newZoom;
    this.camera.y = pos.y - wy * newZoom;
    this.camera.zoom = newZoom;
  }

  processKeys(dt: number): void {
    const speed = 5 / this.camera.zoom;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.camera.x += speed * 8;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) this.camera.x -= speed * 8;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) this.camera.y += speed * 8;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) this.camera.y -= speed * 8;
  }

  get hoveredTile(): { x: number; y: number } | null { return this._hoveredTile; }
  get clickedTile(): { x: number; y: number } | null { return this._clickedTile; }

  centerCamera(worldX: number, worldY: number): void {
    this.camera.x = CANVAS.WIDTH / 2 - worldX * this.camera.zoom;
    this.camera.y = CANVAS.HEIGHT / 2 - worldY * this.camera.zoom;
  }
}