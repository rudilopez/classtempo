import { formatTime } from '../types';
import { CUE_SLOTS, type Cue } from './cueStore';

/** One colour per pad; the waveform markers use the same colours. */
export const PAD_COLORS: readonly string[] = ['#ff5c7a', '#ff9f40', '#ffd84d', '#38e07a', '#4fd1ff', '#7b8cff', '#c77dff', '#ff6fae'];

export function padColor(index: number): string {
  return PAD_COLORS[index % PAD_COLORS.length] ?? '#fff';
}

interface Props {
  cues: readonly (Cue | null)[];
  editing: boolean;
  locked?: boolean;
  disabled: boolean;
  /** Launches a set pad, or sets an empty one; while editing, (re)sets any pad. */
  onPress: (index: number) => void;
  onClear: (index: number) => void;
  onRename: (index: number) => void;
}

/** 4×2 grid of big, touch-friendly cue pads. */
export function CuePads({ cues, editing, locked = false, disabled, onPress, onClear, onRename }: Props) {
  return (
    <div className="pads">
      {Array.from({ length: CUE_SLOTS }, (_, i) => {
        const cue = cues[i] ?? null;
        const title = cue
          ? editing
            ? `Move to the current position (key ${i + 1})`
            : `Launch (key ${i + 1})`
          : locked ? 'Edit cues to add a cue here' : `Set a cue at the current position (key ${i + 1})`;
        return (
          <div key={i} className="pad-slot">
            <button
              className={`pad ${cue ? 'set' : 'empty'} ${editing ? 'editing' : ''}`}
              style={{ ['--pad' as string]: padColor(i) }}
              disabled={disabled || (locked && !cue)}
              onClick={() => onPress(i)}
              title={title}
            >
              <span className="pad-key">{i + 1}</span>
              <span className="pad-name">{cue ? cue.name : locked ? 'Empty' : 'Set cue'}</span>
              <span className="pad-time">{cue ? formatTime(cue.time) : '—'}</span>
            </button>
            {/* Rename is its own control (documented as such): a double-click on the pad would first move the cue, and is unreliable on touch. */}
            {editing && cue && (
              <>
                <button className="pad-tool pad-clear" onClick={() => onClear(i)} title="Clear cue" aria-label={`Clear ${cue.name}`}>
                  ✕
                </button>
                <button className="pad-tool pad-rename" onClick={() => onRename(i)} title="Rename cue" aria-label={`Rename ${cue.name}`}>
                  ✎
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
