import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}

/** A source picker uses the same modal focus boundary as the local media library. */
export function AppleMusicPicker({ title, onClose, busy = false, children }: Props): React.ReactElement {
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  useLayoutEffect(() => {
    if (!overlay.current || !panel.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const states = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay.current)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of states) element.inert = true;
    panel.current.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (!panel.current) return;
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.busy) latest.current.onClose();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'))
          .filter((element) => !element.hidden && element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); panel.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      for (const { element, inert } of states) element.inert = inert;
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLButtonElement>('.apple-music-app .dancer-transport button')?.focus();
    };
  }, []);
  return createPortal(<div className="apple-music-overlay" ref={overlay}>
    <div className="apple-music-picker" ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="apple-music-picker-heading"><h2>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label={`Close ${title}`}>✕</button></div>
      {children}
    </div>
  </div>, document.body);
}
