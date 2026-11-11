import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';

interface InlineTextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'onFocus'> {
  value: string;
  /** Called with the trimmed (and validated) value when the user confirms a change. */
  onCommit: (value: string) => void;
  /** Called after the edit ends (commit, cancel or blur) – used by edit-mode toggles. */
  onDone?: () => void;
  /** Normalises input; return null to reject (the field reverts). Defaults to trim + non-empty. */
  validate?: (raw: string) => string | null;
  /** Focus and select the text on mount (for click-to-edit fields). */
  autoSelect?: boolean;
}

const defaultValidate = (raw: string) => raw.trim() || null;

/**
 * Text input with editor-style semantics:
 *  Enter / blur → commit · Escape → cancel (never commits) · invalid → revert.
 * Edits are kept in a local draft so every keystroke doesn't create an undo step.
 */
export function InlineTextInput({
  value,
  onCommit,
  onDone,
  validate = defaultValidate,
  autoSelect,
  ...rest
}: InlineTextInputProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  /** True once the current edit has been resolved, so a trailing blur is ignored. */
  const settled = useRef(false);

  // Reflect external changes (e.g. undo) when not actively editing.
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);

  useLayoutEffect(() => {
    if (autoSelect && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoSelect]);

  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) {
      const next = validate(draft);
      if (next !== null && next !== value) onCommit(next);
      else setDraft(value);
    } else {
      setDraft(value);
    }
    onDone?.();
  };

  return (
    <input
      ref={ref}
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        settled.current = false;
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
          ref.current?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // don't let the global Escape clear the selection
          finish(false);
          ref.current?.blur();
        }
      }}
    />
  );
}
