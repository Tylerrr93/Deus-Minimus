import { STAGE_DEFINITIONS, StageId, StageDefinition, SimStats } from './stageDefinitions';

export class StageManager {
  private currentIndex: number = 0;
  private onStageChange?: (prev: StageDefinition, next: StageDefinition) => void;

  constructor(onStageChange?: (prev: StageDefinition, next: StageDefinition) => void) {
    this.onStageChange = onStageChange;
  }

  get current(): StageDefinition   { return STAGE_DEFINITIONS[this.currentIndex]; }
  get currentId(): StageId         { return this.current.id; }
  get allStages(): StageDefinition[]{ return STAGE_DEFINITIONS; }
  get progress(): number           { return this.currentIndex / (STAGE_DEFINITIONS.length - 1); }

  /** Pass settlements too so onEnter callbacks can use it. */
  checkTransition(stats: SimStats, world: any, entityManager: any, settlements?: any): boolean {
    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= STAGE_DEFINITIONS.length) return false;

    const next = STAGE_DEFINITIONS[nextIndex];
    if (next.unlockCondition(stats)) {
      const prev = this.current;
      this.currentIndex = nextIndex;
      if (next.onEnter) next.onEnter(world, entityManager, settlements);
      if (this.onStageChange) this.onStageChange(prev, next);
      return true;
    }
    return false;
  }

  hasMechanic(mechanic: string): boolean {
    for (let i = 0; i <= this.currentIndex; i++) {
      if (STAGE_DEFINITIONS[i].mechanics.includes(mechanic)) return true;
    }
    return false;
  }

  isAtOrPast(id: StageId): boolean {
    const targetIdx = STAGE_DEFINITIONS.findIndex(s => s.id === id);
    return this.currentIndex >= targetIdx;
  }
}
