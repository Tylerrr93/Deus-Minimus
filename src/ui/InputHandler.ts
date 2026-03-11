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

  // --- PROPERTIES FOR CYCLING ---
  private lastClickWorld = { x: 0, y: 0 };
  private clickCycleIndex = 0;

  // --- PROPERTIES FOR MULTI-TOUCH ZOOM ---
  private activePointers: Map<number, PointerEvent> = new Map();
  private lastPinchDistance: number | null = null;

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
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
    
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

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, e);

    // Single touch (or mouse) -> start panning
    if (this.activePointers.size === 1) {
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        this.dragDistance = 0;
        this.isDragging = true;
        const pos = this.getEventPos(e);
        this.dragStart = pos;
        this.cameraStart = { x: this.camera.x, y: this.camera.y };
      }
    } 
    // Two touches -> cancel panning, prepare for pinch zoom
    else if (this.activePointers.size === 2) {
      this.isDragging = false;
      this.lastPinchDistance = null;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, e);
    }

    // --- PINCH TO ZOOM LOGIC ---
    if (this.activePointers.size === 2) {
      this.dragDistance = 100; // Artificially bump drag distance so letting go doesn't trigger a click
      
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);

      if (this.lastPinchDistance !== null) {
        const delta = dist - this.lastPinchDistance;
        const zoomFactor = 1.0 + delta * 0.01; // Adjust this multiplier for pinch speed
        const newZoom = Math.max(0.5, Math.min(8, this.camera.zoom * zoomFactor));

        // Find the midpoint between the two fingers to zoom into
        const centerX = (pts[0].clientX + pts[1].clientX) / 2;
        const centerY = (pts[0].clientY + pts[1].clientY) / 2;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const cx = (centerX - rect.left) * scaleX;
        const cy = (centerY - rect.top) * scaleY;

        const wx = (cx - this.camera.x) / this.camera.zoom;
        const wy = (cy - this.camera.y) / this.camera.zoom;
        
        this.camera.x = cx - wx * newZoom;
        this.camera.y = cy - wy * newZoom;
        this.camera.zoom = newZoom;
      }
      
      this.lastPinchDistance = dist;
      return; // Skip normal panning logic when pinching
    }

    // --- PANNING & HOVER LOGIC ---
    if (!e.isPrimary) return;

    const pos = this.getEventPos(e);
    const world = this.screenToWorld(pos.x, pos.y);
    this._hoveredTile = this.worldToTile(world.x, world.y);

    if (this.isDragging && this.activePointers.size === 1) {
      const dx = pos.x - this.dragStart.x;
      const dy = pos.y - this.dragStart.y;
      this.dragDistance += Math.hypot(dx - (this.camera.x - this.cameraStart.x),
                                       dy - (this.camera.y - this.cameraStart.y));
      this.camera.x = this.cameraStart.x + dx;
      this.camera.y = this.cameraStart.y + dy;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.canvas.releasePointerCapture(e.pointerId);
    this.activePointers.delete(e.pointerId);

    // If we dropped below 2 fingers, reset the pinch tracker
    if (this.activePointers.size < 2) {
      this.lastPinchDistance = null;
    }

    // If the user lifted one finger but left another on the screen, smoothly transition back to panning
    if (this.activePointers.size === 1) {
      const remainingPointer = Array.from(this.activePointers.values())[0];
      this.dragStart = this.getEventPos(remainingPointer);
      this.cameraStart = { x: this.camera.x, y: this.camera.y };
      this.isDragging = true;
      return; 
    }

    // Click Evaluation
    if (e.isPrimary && e.button === 0 && this.activePointers.size === 0) {
      this.isDragging = false;
      
      if (this.dragDistance < 10) {
        const pos = this.getEventPos(e);
        const world = this.screenToWorld(pos.x, pos.y);
        const tile = this.worldToTile(world.x, world.y);
        this._clickedTile = tile;

        const distToLast = Math.hypot(world.x - this.lastClickWorld.x, world.y - this.lastClickWorld.y);
        if (distToLast < WORLD.TILE_SIZE * 0.5) {
          this.clickCycleIndex++;
        } else {
          this.clickCycleIndex = 0;
          this.lastClickWorld = world;
        }

        const selectables: any[] = [];
        
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
          
          hitEntities.sort((a, b) => a.dist - b.dist);
          selectables.push(...hitEntities.map(h => h.entity));
        }

        selectables.push(tile);

        const selected = selectables[this.clickCycleIndex % selectables.length];

        if ('id' in selected) {
          this.onEntityClick?.(selected as EntityState);
        } else {
          this.onTileClick?.(selected as { x: number; y: number });
        }
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