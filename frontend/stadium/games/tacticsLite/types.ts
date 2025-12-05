import { TacticsLiteResult } from "../types";

export interface TacticsLiteOptions {
  onRoundEnd?: (result: TacticsLiteResult) => void;
}

export interface TacticsLiteGameConfig extends TacticsLiteOptions {
  width?: number;
  height?: number;
  parent: HTMLElement;
}
