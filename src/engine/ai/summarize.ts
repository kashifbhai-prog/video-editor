// ---------------------------------------------------------------------------
// On-device extractive summarisation (no language model, no network):
// sentences from the transcript are ranked with TextRank over TF-IDF vectors
// (works for English, Urdu and other space-separated languages), the summary
// is the top sentences in their original order, and highlights are built
// from the best sentences / most active scenes with timestamps.
// ---------------------------------------------------------------------------

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export interface RankedSentence extends TimedText {
  score: number;
}

const STOP_EN = new Set(
  'a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those i you he she we they me him her us them my your his our their what which who whom whose when where why how not no yes do does did done have has had will would can could should may might must just very also too than there here about into over under again more most some any each all both few other such only own same s t don now up down out off ok okay oh um uh like really going get got thing things know think yeah well'.split(' '),
);
// Common Urdu function words (Arabic script) and Roman-Urdu fillers.
const STOP_UR = new Set(
  'کا کی کے کو میں سے پر اور یہ وہ ہے ہیں تھا تھی تھے بھی تو نے کہ جو کیا ہو گا گی گے ایک اس ان آپ ہم نہیں جی ہاں لیے ساتھ بات اب پھر hai hain ka ki ke ko mein se par aur yeh woh tha thi bhi to ne keh jo kya ho ga gi ge ek is un aap hum nahi ji haan liye sath baat ab phir'.split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP_EN.has(w) && !STOP_UR.has(w));
}

/** Joins caption cues into sentences (., ?, !, Urdu ۔ and ؟), keeping their time span. */
export function toSentences(cues: TimedText[]): TimedText[] {
  const out: TimedText[] = [];
  let cur: TimedText | null = null;
  for (const c of cues) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    cur = cur ? { start: cur.start, end: c.end, text: `${cur.text} ${text}` } : { ...c, text };
    if (/[.!?۔؟]["')\]]?$/.test(text) || cur.end - cur.start > 15) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** TextRank sentence scores (0..1). */
export function rankSentences(sentences: TimedText[]): RankedSentence[] {
  const docs = sentences.map((s) => tokenize(s.text));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const vecs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    tf.forEach((c, w) => {
      const x = (c / d.length) * Math.log(1 + N / (df.get(w) ?? 1));
      v.set(w, x);
      norm += x * x;
    });
    return { v, norm: Math.sqrt(norm) || 1 };
  });
  const sim = (a: (typeof vecs)[number], b: (typeof vecs)[number]) => {
    let dot = 0;
    a.v.forEach((x, w) => {
      const y = b.v.get(w);
      if (y) dot += x * y;
    });
    return dot / (a.norm * b.norm);
  };
  const W = vecs.map((a, i) => vecs.map((b, j) => (i === j ? 0 : sim(a, b))));
  let score = new Array(N).fill(1 / Math.max(1, N));
  for (let it = 0; it < 30; it++) {
    score = score.map((_, i) => {
      let s = 0;
      for (let j = 0; j < N; j++) {
        const out = W[j].reduce((a, b) => a + b, 0);
        if (out > 0) s += (W[j][i] / out) * score[j];
      }
      return 0.15 / N + 0.85 * s;
    });
  }
  const max = Math.max(...score, 1e-9);
  return sentences.map((s, i) => {
    const words = docs[i].length;
    // Very short sentences ("Thank you.") carry little content.
    const lengthFactor = Math.min(1, words / 5);
    // Isolated sentences (no similarity to others) still count by their information.
    const info = Math.min(1, words / 12) * 0.35;
    return { ...s, score: Math.min(1, (score[i] / max) * 0.65 * lengthFactor + info) };
  });
}

/** Most characteristic words (TF-IDF over sentences). */
export function keywords(sentences: TimedText[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const s of sentences) for (const w of tokenize(s.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([w]) => w.length > 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, n)
    .map(([w]) => w);
}

export interface HighlightCandidate {
  start: number;
  end: number;
  score: number;
  label: string;
}

/**
 * Picks highlight ranges up to `target` seconds total: the best moments,
 * padded slightly, merged when they touch, returned in timeline order.
 */
export function pickHighlights(cands: HighlightCandidate[], target: number, duration: number): HighlightCandidate[] {
  const chosen: HighlightCandidate[] = [];
  let total = 0;
  for (const c of [...cands].sort((a, b) => b.score - a.score)) {
    const s = Math.max(0, c.start - 0.25);
    const e = Math.min(duration, c.end + 0.35);
    if (e - s < 0.5) continue;
    if (chosen.some((x) => s < x.end && e > x.start)) continue;
    if (total + (e - s) > target * 1.15 && chosen.length) continue;
    chosen.push({ ...c, start: s, end: e });
    total += e - s;
    if (total >= target) break;
  }
  return chosen.sort((a, b) => a.start - b.start);
}
