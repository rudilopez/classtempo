import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './classes.css';

export interface ClassControlItem {
  id: string;
  name: string;
  detail?: string;
  note?: string;
  available?: boolean;
}

export interface ClassControlsProps {
  className: string;
  items: readonly ClassControlItem[];
  currentEntryId: string | null;
  autoNext: boolean;
  busy?: boolean;
  /** Fetching the next local file must not disable the current exercise or running order. */
  nextBusy?: boolean;
  status?: string;
  onNext: () => void;
  /** Selecting a running-order item opens it paused. */
  onSelect: (entryId: string) => void;
  onPrevious?: () => void;
  onAutoNext: (enabled: boolean) => void;
  onExit: () => void;
  onOpenChange?: (open: boolean) => void;
  /** Stage coordinates this with its Cues and Tools trays. */
  open?: boolean;
}

interface Props extends ClassControlsProps {
  variant?: 'player' | 'stage';
}

/** One teaching strip; the regular player opens a dialog and Stage keeps its list below the picture. */
export function ClassControls({
  className, items, currentEntryId, autoNext, busy = false, nextBusy = false, status,
  onNext, onSelect, onPrevious, onAutoNext, onExit, onOpenChange, open, variant = 'player',
}: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const currentIndex = items.findIndex((item) => item.id === currentEntryId);
  const current = items[currentIndex];
  const next = items[currentIndex + 1];
  const previous = items[currentIndex - 1];
  const last = currentIndex >= 0 && currentIndex === items.length - 1;
  const changeOpen = (value: boolean) => {
    if (open === undefined) setLocalOpen(value);
    onOpenChange?.(value);
  };
  const latest = useRef({ expanded, onOpenChange, changeOpen });
  latest.current = { expanded, onOpenChange, changeOpen };

  useEffect(() => () => {
    if (latest.current.expanded) latest.current.onOpenChange?.(false);
  }, []);

  useLayoutEffect(() => {
    if (!expanded || !drawer.current) return;
    if (variant === 'stage') {
      drawer.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay.current)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of siblings) element.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? drawer.current)?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); latest.current.changeOpen(false); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      const first = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const outside = !drawer.current?.contains(document.activeElement) || document.activeElement === drawer.current;
      if (!first) { event.preventDefault(); drawer.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); lastNode?.focus(); }
      else if (!event.shiftKey && (document.activeElement === lastNode || outside)) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !drawer.current?.contains(event.target)) focusFirst();
    };
    // Capture stops the global player shortcuts before they can launch cues behind the dialog.
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin, true);
    focusFirst();
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin, true);
      for (const { element, inert } of siblings) element.inert = inert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded, variant]);

  const close = () => { changeOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const select = (entryId: string) => { close(); onSelect(entryId); };
  const runningOrder = expanded && <div
    ref={drawer}
    id={`${id}-order`}
    className={`class-running-order ${variant === 'stage' ? 'class-order-inline' : ''}`}
    role={variant === 'stage' ? 'region' : 'dialog'}
    aria-modal={variant === 'player' ? true : undefined}
    aria-labelledby={`${id}-heading`}
    aria-describedby={`${id}-help`}
    tabIndex={-1}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }}
    onKeyUp={(event) => event.stopPropagation()}
  >
    <div className="class-order-heading">
      <div><strong id={`${id}-heading`}>Running order</strong><span title={className}>{className}</span></div>
      <button onClick={close} aria-label="Close running order" title="Close running order">✕</button>
    </div>
    <p id={`${id}-help`} className="class-order-help">Tap an exercise to open it paused.</p>
    <ol className="class-order-list">
      {items.map((item, index) => <li key={item.id}>
        <button
          className={`class-order-entry ${item.id === currentEntryId ? 'current' : ''}`}
          aria-current={item.id === currentEntryId ? 'step' : undefined}
          disabled={busy || item.available === false}
          onClick={() => select(item.id)}
          title={`${item.name} · ${item.available === false ? 'File unavailable' : 'Open paused'}`}
        >
          <span className="class-entry-number">{index + 1}</span>
          <span className="class-entry-copy"><strong>{item.name}</strong>
            {(item.detail || item.available === false) && <small>{item.available === false ? 'File unavailable' : item.detail}</small>}
            {item.note && <span className="class-entry-note">{item.note}</span>}
          </span>
          {item.id === currentEntryId && <span className="class-entry-current">Current</span>}
        </button>
      </li>)}
    </ol>
    <div className="class-order-actions">
      <button disabled={busy || !previous || previous.available === false} onClick={() => {
        close();
        if (onPrevious) onPrevious();
        else if (previous) onSelect(previous.id);
      }}>← Previous</button>
      <label className="class-auto-next" title="When an exercise ends, play the next one automatically">
        <input type="checkbox" checked={autoNext} disabled={busy} onChange={(event) => onAutoNext(event.target.checked)} />
        <span>Auto-next</span>
      </label>
      <button className="class-exit" onClick={() => { close(); onExit(); }}>Exit class</button>
    </div>
  </div>;

  return <section className={`class-controls class-controls-${variant}`} aria-label="Current class"
    onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }} onKeyUp={(event) => event.stopPropagation()}>
    <div className="class-strip">
      <button ref={trigger} className="class-strip-toggle" aria-expanded={expanded} aria-controls={`${id}-order`}
        aria-label={`${expanded ? 'Close' : 'Open'} running order for ${className}`} onClick={() => changeOpen(!expanded)}>
        <span className="class-strip-heading"><span>{className}</span><small>{currentIndex >= 0 ? `${currentIndex + 1}/${items.length}` : `${items.length} exercises`}</small><span aria-hidden="true">{expanded ? '▴' : '▾'}</span></span>
        <strong title={current?.name}>{current?.name ?? 'Choose an exercise'}</strong>
      </button>
      <button className="class-next" disabled={busy || (!last && (nextBusy || !next || next.available === false))}
        onClick={onNext} aria-busy={nextBusy && !last || undefined}>{nextBusy && !last ? 'Getting ready…' : last ? 'Finish class' : 'Next & play →'}</button>
    </div>
    <div className="class-strip-detail">
      <span title={next?.name}>{next ? `Up next: ${next.name}${next.available === false ? ' · file unavailable' : ''}` : 'Last exercise'}</span>
      <span className="class-session-status" role="status" title={status}>{status || (autoNext ? 'Auto-next on' : 'Manual next')}</span>
    </div>
    {variant === 'stage' ? runningOrder : expanded && createPortal(<div ref={overlay} className="class-order-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>{runningOrder}</div>, document.body)}
  </section>;
}
