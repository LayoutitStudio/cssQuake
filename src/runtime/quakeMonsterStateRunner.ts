import {
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterFrameState,
  type QuakeMonsterFrameEvent,
  type QuakeMonsterLogicDefinition,
  type QuakeMonsterStateChain,
} from "../generated/quakeMonsterLogic";

export const CSSQUAKE_QUAKEC_MONSTER_STATE_RUNNER_ENABLED = false;

export interface QuakeMonsterStateRunnerOptions {
  enabled?: boolean;
  initialChain?: string;
}

export interface QuakeMonsterStateStep {
  calls: readonly string[];
  chain: string;
  chainCycleEnd: boolean;
  classname: string;
  events: readonly QuakeMonsterFrameEvent[];
  frame: string;
  frameIndex: number;
  next: string;
  sounds: readonly string[];
  stateName: string;
}

export interface QuakeMonsterStateRunner {
  advance(): QuakeMonsterStateStep;
  chainLength(chainName: string): number;
  current(): QuakeMonsterStateStep;
  enterChain(chainName: string): QuakeMonsterStateStep | null;
  enterState(stateName: string): QuakeMonsterStateStep | null;
  hasChain(chainName: string): boolean;
}

interface QuakeMonsterStateLocation {
  chain: string;
  index: number;
}

export function createQuakeMonsterStateRunner(
  classname: string,
  options: QuakeMonsterStateRunnerOptions = {},
): QuakeMonsterStateRunner | null {
  if (!(options.enabled ?? CSSQUAKE_QUAKEC_MONSTER_STATE_RUNNER_ENABLED)) return null;
  const logicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;
  const logic = logicByClassname[classname];
  if (!logic) return null;
  return new QuakeMonsterGeneratedStateRunner(classname, logic, options.initialChain ?? "stand");
}

class QuakeMonsterGeneratedStateRunner implements QuakeMonsterStateRunner {
  private readonly stateLocations: Map<string, QuakeMonsterStateLocation>;
  private chainName: string;
  private stateIndex: number;

  constructor(
    private readonly classname: string,
    private readonly logic: QuakeMonsterLogicDefinition,
    initialChain: string,
  ) {
    this.stateLocations = indexStateLocations(logic);
    this.chainName = chainOrFirst(logic, initialChain);
    this.stateIndex = 0;
  }

  advance(): QuakeMonsterStateStep {
    const state = this.currentState();
    const nextLocation = this.stateLocations.get(state.next);
    if (nextLocation) {
      this.chainName = nextLocation.chain;
      this.stateIndex = nextLocation.index;
    }
    return this.current();
  }

  chainLength(chainName: string): number {
    return this.logic.chains[chainName]?.states.length ?? 0;
  }

  current(): QuakeMonsterStateStep {
    const state = this.currentState();
    return {
      calls: state.calls,
      chain: this.chainName,
      chainCycleEnd: this.currentStateEndsChainCycle(state),
      classname: this.classname,
      events: state.events ?? [],
      frame: state.frame,
      frameIndex: state.frameIndex,
      next: state.next,
      sounds: state.sounds,
      stateName: state.name,
    };
  }

  enterChain(chainName: string): QuakeMonsterStateStep | null {
    const chain = this.logic.chains[chainName];
    if (!chain?.states.length) return null;
    this.chainName = chainName;
    this.stateIndex = 0;
    return this.current();
  }

  enterState(stateName: string): QuakeMonsterStateStep | null {
    const location = this.stateLocations.get(stateName);
    if (!location) return null;
    this.chainName = location.chain;
    this.stateIndex = location.index;
    return this.current();
  }

  hasChain(chainName: string): boolean {
    return Boolean(this.logic.chains[chainName]?.states.length);
  }

  private currentChain(): QuakeMonsterStateChain {
    return this.logic.chains[this.chainName] ?? firstChain(this.logic);
  }

  private currentState(): QuakeMonsterFrameState {
    const chain = this.currentChain();
    return chain.states[Math.min(this.stateIndex, Math.max(0, chain.states.length - 1))];
  }

  private currentStateEndsChainCycle(state: QuakeMonsterFrameState): boolean {
    const nextLocation = this.stateLocations.get(state.next);
    return !nextLocation || nextLocation.chain !== this.chainName || nextLocation.index <= this.stateIndex;
  }
}

function indexStateLocations(logic: QuakeMonsterLogicDefinition): Map<string, QuakeMonsterStateLocation> {
  const locations = new Map<string, QuakeMonsterStateLocation>();
  for (const [chain, definition] of Object.entries(logic.chains)) {
    definition.states.forEach((state, index) => {
      locations.set(state.name, { chain, index });
    });
  }
  return locations;
}

function chainOrFirst(logic: QuakeMonsterLogicDefinition, chainName: string): string {
  return logic.chains[chainName] ? chainName : Object.keys(logic.chains)[0] ?? "";
}

function firstChain(logic: QuakeMonsterLogicDefinition): QuakeMonsterStateChain {
  return Object.values(logic.chains)[0] ?? { start: "", states: [] };
}
