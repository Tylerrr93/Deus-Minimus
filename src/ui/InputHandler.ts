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

  // Track pointers for pinch-to-zoom support on mobile
  private activePointers = new Map<number, PointerEvent>();
  private initialPinchDistance = -1;

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
    // Prevent the browser from trying to native-pan or refresh on mobile
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    window.addEventListener('pointermove', this.onPointerMove.bind(this));
    window.addEventListener('pointerup', this.onPointerUp.bind(this));
    window.addEventListener('pointercancel', this.onPointerUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.keys.add(e.key));
    window.addEventListener('keyup', e => this.keys.delete(e.key));
  }

  /**
   * Restricts the camera position so the map can never be completely dragged off-screen.
   * Allows dragging until the edge of the map reaches the center of the canvas.
   */
  private clampCamera(): void {
    const scaledWorldWidth = WORLD.COLS * WORLD.TILE_SIZE * this.camera.zoom;
    const scaledWorldHeight = WORLD.ROWS * WORLD.TILE_SIZE * this.camera.zoom;
    
    // Half the screen width/height is the padding we allow past the map edge
    const marginX = CANVAS.WIDTH / 2;
    const marginY = CANVAS.HEIGHT / 2;

    const minX = -scaledWorldWidth + marginX;
    const maxX = marginX;
    
    const minY = -scaledWorldHeight + marginY;
    const maxY = marginY;

    this.camera.x = Math.max(minX, Math.min(maxX, this.camera.x));
    this.camera.y = Math.max(minY, Math.min(maxY, this.camera.y));
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

  private getEventPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { 
      x: (e.clientX - rect.left) * scaleX, 
      y: (e.clientY - rect.top) * scaleY 
    };
  }

  private pickEntity(wx: number, wy: number): EntityState | null {
    if (!this.em) return null;
    const ts = WORLD.TILE_SIZE;
    const pickRadius = ts * 1.2;
    let best: EntityState | null = null;
    let bestDist = pickRadius;
    this.em.forEachAlive(e => {
      const ex = e.x * ts + ts * 0.5;
      const ey = e.y * ts + ts * 0.5;
      const dist = Math.hypot(wx - ex, wy - ey);
      if (dist < bestDist) { bestDist = dist; best = e; }
    });
    return best;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.target !== this.canvas) return;

    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, e);

    if (this.activePointers.size === 1) {
      if (e.button === 0 || e.button === 1 || e.button === 2 || e.pointerType === 'touch') {
        this.dragDistance = 0;
        this.isDragging = true;
        const pos = this.getEventPos(e);
        this.dragStart = pos;
        this.cameraStart = { x: this.camera.x, y: this.camera.y };
      }
    } else if (this.activePointers.size === 2) {
      this.isDragging = false;
      const pts = Array.from(this.activePointers.values());
      const dx = pts[0].clientX - pts[1].clientX;
      const dy = pts[0].clientY - pts[1].clientY;
      this.initialPinchDistance = Math.hypot(dx, dy);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, e);
    }

    if (e.target === this.canvas) {
      const pos = this.getEventPos(e);
      const world = this.screenToWorld(pos.x, pos.y);
      this._hoveredTile = this.worldToTile(world.x, world.y);
    }

    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dx = pts[0].clientX - pts[1].clientX;
      const dy = pts[0].clientY - pts[1].clientY;
      const dist = Math.hypot(dx, dy);

      if (this.initialPinchDistance > 0) {
        const zoomDelta = dist / this.initialPinchDistance;
        const newZoom = Math.max(0.5, Math.min(8, this.camera.zoom * zoomDelta));

        if (newZoom !== this.camera.zoom) {
          const cx = (pts[0].clientX + pts[1].clientX) / 2;
          const cy = (pts[0].clientY + pts[1].clientY) / 2;
          const centerPos = this.getEventPos({ clientX: cx, clientY: cy } as any);

          const wx = (centerPos.x - this.camera.x) / this.camera.zoom;
          const wy = (centerPos.y - this.camera.y) / this.camera.zoom;

          this.camera.x = centerPos.x - wx * newZoom;
          this.camera.y = centerPos.y - wy * newZoom;
          this.camera.zoom = newZoom;
          
          this.clampCamera(); // Clamp after pinch zooming
        }
      }
      this.initialPinchDistance = dist;
    } else if (this.isDragging && this.activePointers.has(e.pointerId)) {
      const pos = this.getEventPos(e);
      const dx = pos.x - this.dragStart.x;
      const dy = pos.y - this.dragStart.y;
      this.dragDistance += Math.hypot(
        dx - (this.camera.x - this.cameraStart.x),
        dy - (this.camera.y - this.cameraStart.y)
      );
      this.camera.x = this.cameraStart.x + dx;
      this.camera.y = this.cameraStart.y + dy;
      
      this.clampCamera(); // Clamp after dragging
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const wasPinching = this.activePointers.size === 2;
    this.activePointers.delete(e.pointerId);

    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}

    if (wasPinching) {
      this.initialPinchDistance = -1;
      // Prevent remaining finger from initiating an accidental click
      if (this.activePointers.size === 1) {
        const remainingEvent = Array.from(this.activePointers.values())[0];
        this.dragStart = this.getEventPos(remainingEvent);
        this.cameraStart = { x: this.camera.x, y: this.camera.y };
        this.isDragging = true;
        this.dragDistance = 50; 
      }
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      if (this.dragDistance < 5) {
        const pos = this.getEventPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        const tile = this.worldToTile(world.x, world.y);
        this._clickedTile = tile;
        const entity = this.pickEntity(world.x, world.y);
        if (entity) {
          this.onEntityClick?.(entity);
        } else {
          this.onTileClick?.(tile);
        }
      }
      this.dragDistance = 0;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (e.target !== this.canvas) return;
    
    e.preventDefault();
    const pos = this.getEventPos(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.5, Math.min(8, this.camera.zoom * zoomFactor));

    const wx = (pos.x - this.camera.x) / this.camera.zoom;
    const wy = (pos.y - this.camera.y) / this.camera.zoom;
    this.camera.x = pos.x - wx * newZoom;
    this.camera.y = pos.y - wy * newZoom;
    this.camera.zoom = newZoom;
    
    this.clampCamera(); // Clamp after scroll zooming
  }

  processKeys(dt: number): void {
    const speed = 5 / this.camera.zoom;
    let moved = false;
    
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) { this.camera.x += speed * 8; moved = true; }
    if (this.keys.has('ArrowRight') || this.keys.has('d')) { this.camera.x -= speed * 8; moved = true; }
    if (this.keys.has('ArrowUp') || this.keys.has('w')) { this.camera.y += speed * 8; moved = true; }
    if (this.keys.has('ArrowDown') || this.keys.has('s')) { this.camera.y -= speed * 8; moved = true; }
    
    if (moved) this.clampCamera(); // Clamp after keyboard movement
  }

  get hoveredTile(): { x: number; y: number } | null { return this._hoveredTile; }
  get clickedTile(): { x: number; y: number } | null { return this._clickedTile; }

  centerCamera(worldX: number, worldY: number): void {
    this.camera.x = CANVAS.WIDTH / 2 - worldX * this.camera.zoom;
    this.camera.y = CANVAS.HEIGHT / 2 - worldY * this.camera.zoom;
    this.clampCamera(); // Clamp after centering on an entity
  }
}