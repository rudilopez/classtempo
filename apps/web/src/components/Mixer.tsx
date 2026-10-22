import type { Deck, Engine, EqBand } from '@mixdeck/engine';
import { useState } from 'react';
import type { DeckUiState } from '../types';

interface Props {
  engine: Engine;
  a: DeckUiState;
  b: DeckUiState;
}

const BANDS: EqBand[] = ['high', 'mid', 'low'];

function Strip({ deck, accent }: { deck: Deck; accent: string }) {
  const [eq, setEq] = useState<Record<EqBand, number>>({ low: 0, mid: 0, high: 0 });
  const [fader, setFader] = useState(1);
  return (
    <div className="strip" style={{ ['--accent' as string]: accent }}>
      {BANDS.map((band) => (
        <label key={band} className="knob">
          <span>{band.toUpperCase()}</span>
          <input
            type="range"
            min={-24}
            max={6}
            step={0.5}
            value={eq[band]}
            onChange={(e) => {
              const v = Number(e.target.value);
              deck.setEq(band, v);
              setEq((s) => ({ ...s, [band]: v }));
            }}
            onDoubleClick={() => {
              deck.setEq(band, 0);
              setEq((s) => ({ ...s, [band]: 0 }));
            }}
          />
          <span className="val">{eq[band] > 0 ? '+' : ''}{eq[band]} dB</span>
        </label>
      ))}
      <label className="fader">
        <input
          type="range"
          className="vertical"
          min={0}
          max={1}
          step={0.01}
          value={fader}
          onChange={(e) => {
            const v = Number(e.target.value);
            deck.setFader(v);
            setFader(v);
          }}
        />
      </label>
    </div>
  );
}

export function Mixer({ engine }: Props) {
  const [xf, setXf] = useState(0);
  const [master, setMaster] = useState(0.9);
  return (
    <section className="mixer">
      <div className="strips">
        <Strip deck={engine.decks[0]} accent="var(--a)" />
        <div className="master">
          <span>MASTER</span>
          <input
            type="range"
            className="vertical"
            min={0}
            max={1.2}
            step={0.01}
            value={master}
            onChange={(e) => {
              const v = Number(e.target.value);
              engine.setMasterGain(v);
              setMaster(v);
            }}
          />
        </div>
        <Strip deck={engine.decks[1]} accent="var(--b)" />
      </div>
      <div className="crossfader">
        <span className="xa">A</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={xf}
          onChange={(e) => {
            const v = Number(e.target.value);
            engine.setCrossfader(v);
            setXf(v);
          }}
          onDoubleClick={() => {
            engine.setCrossfader(0);
            setXf(0);
          }}
        />
        <span className="xb">B</span>
      </div>
    </section>
  );
}
