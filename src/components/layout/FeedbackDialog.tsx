import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Bug, CheckCircle2, HelpCircle, Lightbulb, type LucideIcon } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { FEEDBACK_KIND_LABEL, sendFeedback, technicalInfo, type FeedbackKind } from '../../services/feedback';
import { track } from '../../services/analytics';
import { Dialog } from '../controls/Dialog';
import { Button } from '../controls/Button';
import { cn } from '../../utils/cn';

const KINDS: { kind: FeedbackKind; icon: LucideIcon; hint: string }[] = [
  { kind: 'issue', icon: Bug, hint: 'Something is broken or not working as expected' },
  { kind: 'suggestion', icon: Lightbulb, hint: 'An idea or a feature you would like' },
  { kind: 'question', icon: HelpCircle, hint: 'Not sure how something works' },
];

const PLACEHOLDER: Record<FeedbackKind, string> = {
  issue: 'What happened, and what did you expect? Steps to reproduce help a lot (e.g. "I split a video, added a wipe, and on export…").',
  suggestion: 'What would you like Cutistic to do, and how would it help you?',
  question: 'What would you like to know?',
};

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const inputCls =
  'w-full rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 text-[12px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none';

export function FeedbackDialog() {
  const close = () => useUiStore.getState().openDialog(null);
  const [kind, setKind] = useState<FeedbackKind>('issue');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [includeTech, setIncludeTech] = useState(true);
  const [showTech, setShowTech] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'mail'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const tech = useMemo(() => technicalInfo(), []);

  const msgShort = message.trim().length < MIN_MESSAGE;
  const emailBad = email.trim() !== '' && !EMAIL_RE.test(email.trim());
  const invalid = msgShort || emailBad;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (invalid || state === 'sending') return;
    // Bots fill every field; people never see this one.
    if (honeypot.current?.value) {
      setState('sent');
      return;
    }
    setState('sending');
    setError(null);
    const res = await sendFeedback({ kind, message: message.trim(), name: name.trim(), email: email.trim(), tech: includeTech ? tech : null });
    if (res.ok) {
      track('feedback_sent', { kind });
      setState(res.via === 'mail' ? 'mail' : 'sent');
    } else {
      setError(res.error);
      setState('idle');
    }
  };

  if (state === 'sent' || state === 'mail') {
    return (
      <Dialog title="Feedback" onClose={close} width={460} footer={<Button variant="primary" onClick={close}>Close</Button>}>
        <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="feedback-done">
          <CheckCircle2 size={40} className="text-success" />
          <h3 className="text-[15px] font-semibold">Thank you!</h3>
          <p className="max-w-[340px] text-[12px] leading-relaxed text-fg-muted">
            {state === 'sent'
              ? 'Your feedback has been sent. We read every message and use it to improve Cutistic.'
              : 'Your email app has opened with your message – press Send there to deliver it.'}
            {state === 'sent' && email.trim() && ' If a reply is needed, we will write to you by email.'}
          </p>
        </div>
      </Dialog>
    );
  }

  const footer = (
    <>
      <span className="mr-auto text-[10px] text-fg-subtle">Your videos and projects are never sent.</span>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <button
        type="submit"
        form="feedback-form"
        disabled={state === 'sending'}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
      >
        {state === 'sending' ? 'Sending…' : 'Send feedback'}
      </button>
    </>
  );

  return (
    <Dialog title="Send feedback" onClose={close} width={520} footer={footer}>
      <form id="feedback-form" onSubmit={submit} noValidate className="space-y-4" data-testid="feedback-form">
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Found a problem or have an idea? Tell us – it helps make Cutistic better for everyone.
        </p>

        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Type</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Feedback type">
            {KINDS.map(({ kind: k, icon: Icon, hint }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                title={hint}
                onClick={() => setKind(k)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-[12px] transition-colors',
                  kind === k ? 'border-success bg-success/10 text-fg' : 'border-line-strong bg-panel-2 text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <Icon size={16} className={kind === k ? 'text-success' : undefined} />
                {FEEDBACK_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Message <span className="font-normal normal-case tracking-normal text-fg-subtle">{message.length}/{MAX_MESSAGE}</span>
          </span>
          <textarea
            autoFocus
            rows={6}
            maxLength={MAX_MESSAGE}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={PLACEHOLDER[kind]}
            aria-invalid={touched && msgShort}
            className={cn(inputCls, 'resize-y leading-relaxed', touched && msgShort && 'border-danger')}
          />
          {touched && msgShort && <span className="mt-1 block text-[11px] text-danger">Please write at least {MIN_MESSAGE} characters.</span>}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Name <span className="font-normal normal-case tracking-normal text-fg-subtle">(optional)</span>
            </span>
            <input type="text" maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Email <span className="font-normal normal-case tracking-normal text-fg-subtle">(optional)</span>
            </span>
            <input
              type="email"
              maxLength={200}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="So we can reply"
              aria-invalid={touched && emailBad}
              className={cn(inputCls, touched && emailBad && 'border-danger')}
            />
            {touched && emailBad && <span className="mt-1 block text-[11px] text-danger">This email address doesn't look right.</span>}
          </label>
        </div>

        {/* Spam trap: hidden from people and screen readers. */}
        <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />

        <div className="rounded-md border border-line bg-panel-2/60 p-2.5">
          <label className="flex cursor-pointer items-start gap-2 text-[12px]">
            <input type="checkbox" checked={includeTech} onChange={(e) => setIncludeTech(e.target.checked)} className="mt-0.5 accent-[var(--color-success)]" />
            <span>
              Include technical info <span className="text-fg-subtle">(browser, system, screen size – helps us fix issues)</span>
            </span>
          </label>
          <button type="button" onClick={() => setShowTech((v) => !v)} className="mt-1 ml-6 text-[11px] text-accent hover:underline">
            {showTech ? 'Hide details' : 'See what is sent'}
          </button>
          {showTech && (
            <dl className="mt-2 ml-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-fg-muted">
              {Object.entries(tech).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-subtle">{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
