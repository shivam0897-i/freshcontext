const CJK = /[㐀-鿿぀-ヿ가-힯]/g

/**
 * Instant, dependency-free token estimate.
 *
 * Calibrated against gpt-tokenizer (o200k_base) on 2026-09-06 — measured
 * errors on calibration samples: English prose +28%, code −21%, long text
 * +27%, CJK −2%. Deliberately conservative: overestimating slightly is
 * better than underestimating for a "how full is my context" meter, and the
 * exact count from the background service worker supersedes this whenever it
 * is available. Everything derived from this heuristic is labeled as an
 * estimate in the UI.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(CJK) || []).length
  const rest = text.length - cjk
  return Math.round(cjk * 0.85) + Math.ceil(rest / 4.5)
}
