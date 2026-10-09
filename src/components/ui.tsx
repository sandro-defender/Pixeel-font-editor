/** Small shared UI primitives. */
import React, { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

export function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'danger' | 'ghost' | 'default'; tip?: string }) {
  const { kind = 'default', tip, className = '', children, ...rest } = props;
  return (
    <button
      type="button"
      className={`btn btn-${kind} ${className}`}
      title={tip}
      aria-label={tip ?? (typeof children === 'string' ? children : undefined)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; tip: string; active?: boolean }) {
  const { icon, tip, active, className = '', ...rest } = props;
  return (
    <button
      type="button"
      className={`btn btn-icon ${active ? 'btn-active' : ''} ${className}`}
      title={tip}
      aria-label={tip}
      aria-pressed={active}
      {...rest}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="field" htmlFor={props.htmlFor}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function ModalShell(props: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <Btn kind="ghost" onClick={props.onClose} tip="Close dialog">✕ Close</Btn>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Dismiss">
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy-overlay" role="progressbar" aria-label={busy}>
      <div className="busy-box">
        <div className="spinner" aria-hidden />
        <div>{busy}</div>
      </div>
    </div>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChange: (v: boolean) => void; tip?: string; disabled?: boolean }) {
  return (
    <label className="checkbox" title={props.tip}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function SegBtns<T extends string>(props: { value: T; options: Array<{ v: T; label: string; tip?: string }>; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div className="segbtns" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.v}
          type="button"
          className={`segbtn ${props.value === o.v ? 'segbtn-active' : ''}`}
          title={o.tip ?? o.label}
          aria-pressed={props.value === o.v}
          onClick={() => props.onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
