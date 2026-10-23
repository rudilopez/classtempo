import './cueStems.css';

export type CuePanel = 'cues' | 'stems';

interface Props {
  value: CuePanel;
  onChange: (value: CuePanel) => void;
}

/** Selects the contents of the pad area without affecting playback. */
export function CueStemsSwitch({ value, onChange }: Props) {
  return <div className="cue-stems-switch" role="group" aria-label="Cues or stems"
    onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
    <button type="button" aria-pressed={value === 'cues'} onClick={() => onChange('cues')}>Cues</button>
    <button type="button" aria-pressed={value === 'stems'} onClick={() => onChange('stems')}>Stems</button>
  </div>;
}

export function StemsUnavailable() {
  return <div className="stems-unavailable" role="status">
    <strong>Stems aren’t available yet</strong>
    <p>Separate vocal and instrument playback is not supported in this version.</p>
  </div>;
}
