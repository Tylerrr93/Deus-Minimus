import { Camera } from './Renderer';
import { CANVAS, WORLD } from '../config/constants';

export class InputHandler {
  private keys: Set<string> = new Set();
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private cameraStart = { x: 0, y: 0 };

  private _hoveredTile: { x: number; y: number } | null = null;
  private _clickedTile: { x: number; y: number } | null = null;

  onTileClick?: (tile: { x: number; y: number }) => void;

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
    // Convert screen coordinates to world coordinates
    // The rendering uses: ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    // So: screenX = worldX * zoom + cameraX
    // Therefore: worldX = (screenX - cameraX) / zoom
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
    // Scale the mouse position if the canvas is being visually stretched
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return { 
      x: (e.clientX - rect.left) * scaleX, 
      y: (e.clientY - rect.top) * scaleY 
    };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) {
      const pos = this.getEventPos(e);
      const world = this.screenToWorld(pos.x, pos.y);
      const tile = this.worldToTile(world.x, world.y);
      this._clickedTile = tile;
      this.onTileClick?.(tile);
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
      this.camera.x = this.cameraStart.x + (pos.x - this.dragStart.x);
      this.camera.y = this.cameraStart.y + (pos.y - this.dragStart.y);
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 2 || e.button === 1) this.isDragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pos = this.getEventPos(e);
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.5, Math.min(8, this.camera.zoom * zoomFactor));

    // Zoom toward cursor
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
