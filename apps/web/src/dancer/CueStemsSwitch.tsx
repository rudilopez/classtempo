import './cueStems.css';

export type CuePanel = 'cues' | 'stems';

interface Props {
  value: CuePanel;
  onChange: (value: CuePanel) => void;
  stemsDisabled?: boolean;
}

/** Selects the contents of the pad area without affecting playback. */
export function CueStemsSwitch({ value, onChange, stemsDisabled = false }: Props) {
  return <div className="cue-stems-switch" role="group" aria-label="Cues or stems"
    onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
    <button type="button" aria-pressed={value === 'cues'} onClick={() => onChange('cues')}>Cues</button>
    <button type="button" aria-pressed={value === 'stems'} disabled={stemsDisabled}
      title={stemsDisabled ? 'Stems are available for imported audio files only.' : undefined}
      onClick={() => onChange('stems')}>
      Stems{stemsDisabled && <small>Local audio only</small>}
    </button>
  </div>;
}
