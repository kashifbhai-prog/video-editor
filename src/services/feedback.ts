// ---------------------------------------------------------------------------
// Feedback ("Feedback" button in the top bar). Sends what the user typed –
// never media or project content – to VITE_FEEDBACK_URL (a Google Apps Script
// web app that appends a row to a Google Sheet). Without that URL the user's
// mail app opens with the message filled in, addressed to VITE_CONTACT_EMAIL.
// ---------------------------------------------------------------------------

export type FeedbackKind = 'issue' | 'suggestion' | 'question';

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  name: string;
  email: string;
  /** Browser / device details, only when the user leaves "include technical info" on. */
  tech: Record<string, string> | null;
}

export type FeedbackResult = { ok: true; via: 'server' | 'mail' } | { ok: false; error: string };

const ENDPOINT = (import.meta.env.VITE_FEEDBACK_URL as string | undefined)?.trim() || '';
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || '';

export const feedbackConfigured = () => !!ENDPOINT || !!CONTACT;

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  issue: 'Issue / bug',
  suggestion: 'Suggestion',
  question: 'Question',
};

/** Browser, OS and capability details that help reproduce an issue (nothing personal). */
export function technicalInfo(): Record<string, string> {
  const ua = navigator.userAgent;
  const browser =
    /Edg\/([\d.]+)/.exec(ua)?.[0].replace('Edg/', 'Edge ') ??
    /OPR\/([\d.]+)/.exec(ua)?.[0].replace('OPR/', 'Opera ') ??
    /Firefox\/([\d.]+)/.exec(ua)?.[0].replace('/', ' ') ??
    /Chrome\/([\d.]+)/.exec(ua)?.[0].replace('/', ' ') ??
    (/Version\/([\d.]+).*Safari/.exec(ua) ? `Safari ${/Version\/([\d.]+)/.exec(ua)![1]}` : 'Unknown');
  const os = /Windows NT 10/.test(ua)
    ? 'Windows 10/11'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android ([\d.]+)/.exec(ua)?.[0] ?? (/iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown');
  let webgl2 = 'no';
  try {
    webgl2 = document.createElement('canvas').getContext('webgl2') ? 'yes' : 'no';
  } catch {
    /* keep "no" */
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    browser,
    os,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    window: `${window.innerWidth}×${window.innerHeight}`,
    language: navigator.language,
    webgl2,
    webgpu: 'gpu' in navigator ? 'yes' : 'no',
    webcodecs: 'VideoEncoder' in window ? 'yes' : 'no',
    cores: String(navigator.hardwareConcurrency || '?'),
    ...(mem ? { memory: `${mem} GB` } : {}),
    page: location.pathname,
  };
}

function mailBody(f: FeedbackInput) {
  const lines = [f.message, '', f.name && `Name: ${f.name}`, f.email && `Email: ${f.email}`].filter((l) => l !== '' && l !== undefined) as string[];
  if (f.tech) lines.push('', '— Technical info —', ...Object.entries(f.tech).map(([k, v]) => `${k}: ${v}`));
  return lines.join('\n');
}

export async function sendFeedback(f: FeedbackInput): Promise<FeedbackResult> {
  if (ENDPOINT) {
    try {
      // text/plain keeps this a "simple" request (no CORS preflight), which Apps Script web apps need.
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...f, kind: FEEDBACK_KIND_LABEL[f.kind], sentAt: new Date().toISOString() }),
      });
      if (!res.ok) return { ok: false, error: `The server answered ${res.status}. Please try again in a moment.` };
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (data.ok === false) return { ok: false, error: data.error || 'Your feedback could not be saved. Please try again.' };
      return { ok: true, via: 'server' };
    } catch {
      return { ok: false, error: 'Could not reach the feedback service. Check your internet connection and try again.' };
    }
  }
  if (CONTACT) {
    const subject = `Cutistic feedback: ${FEEDBACK_KIND_LABEL[f.kind]}`;
    window.location.href = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody(f))}`;
    return { ok: true, via: 'mail' };
  }
  return { ok: false, error: 'Feedback is not set up on this site yet.' };
}
