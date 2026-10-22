/**
 * Phase 3 scaffold. The mapping schema is defined now so Phase 1 engine actions are designed to be
 * bindable (every user-facing action gets a stable `ActionId`).
 */

export type ActionId =
  | `deck.${0 | 1 | 2 | 3}.${'play' | 'cue' | 'sync' | 'pitch' | 'jog' | 'loop.auto' | 'loop.in' | 'loop.out' | 'eq.low' | 'eq.mid' | 'eq.high' | 'filter' | 'fader' | `hotcue.${number}` | `pad.${number}`}`
  | 'mixer.crossfader'
  | 'mixer.master'
  | 'mixer.cueMix'
  | `fx.${number}.${'on' | 'amount' | 'select'}`
  | 'library.scroll'
  | 'library.load.left'
  | 'library.load.right';

export type ControlKind = 'button' | 'knob' | 'fader' | 'encoder' | 'jog';

export interface Binding {
  /** MIDI status byte (0x90 note-on, 0xB0 CC, ...) and data1 */
  status: number;
  data1: number;
  channel?: number;
  kind: ControlKind;
  action: ActionId;
  /** shift-layer index; 0 = no modifier */
  layer?: number;
  /** 14-bit CC pair (MSB/LSB) for high-resolution pitch faders */
  lsb?: number;
  /** LED feedback: message to send for on/off state */
  feedback?: { status: number; data1: number; on: number; off: number };
}

export interface ControllerMapping {
  id: string;
  vendor: string;
  product: string;
  /** substrings matched against MIDIPort.name for auto-detect */
  match: string[];
  version: number;
  bindings: Binding[];
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
