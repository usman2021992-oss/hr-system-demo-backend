import sanitizeHtml from 'sanitize-html';

// ---------------------------------------------------------------------------
// Job description sanitisation
//
// One allowlist, used by three call sites, so the stored value, the Indeed XML
// feed and the compliance checker can never disagree about what a description
// contains:
//
//   - sanitizeStoredDescription() runs on every create/update write.
//   - sanitizeFeedDescription()   runs when the XML feed is built.
//   - the compliance endpoint reports the feed string, so a check never fails
//     on markup that Indeed is never shown.
//
// Word is the reason this exists. Pasting from Office carries a conditional
// comment block (<!--[if gte mso 9]><xml>…<w:LsdException/>…<m:brkBinSub
// m:val="&#8722;&#8722;"/>…</xml><![endif]-->) that survives an attribute-only
// scrub because its content lives inside a comment node. Job posting 20 stored
// 37,138 characters for 3,207 characters of visible text — 433 Office tags —
// and the numeric entity inside Word's formula settings was enough to fail the
// "no raw HTML entities" check on a posting that Indeed had accepted.
//
// sanitize-html discards comment nodes and the content of <style>/<script>, so
// the whole Office payload goes with it.
// ---------------------------------------------------------------------------

/**
 * Tags kept in a stored description. This is the list agreed with the client
 * (p, br, ul, ol, li, strong, em) plus <u>: the editor toolbar exposes an
 * underline button, and dropping <u> here would silently delete formatting a
 * user had deliberately applied.
 *
 * <b> and <i> are absent by design — document.execCommand emits them, so they
 * are folded into <strong>/<em> below rather than allowed through. That keeps
 * one spelling of bold and italic in the database instead of two.
 */
const ALLOWED_DESCRIPTION_TAGS = ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'u'];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_DESCRIPTION_TAGS,
  allowedAttributes: {},
  // Office and the browser both emit <b>/<i>; normalise to the semantic tags.
  // <div> is deliberately not remapped to <p>: Word wraps whole sections in
  // divs, and turning those into paragraphs would nest a <ul> inside a <p>.
  // Unlisted tags are unwrapped by sanitize-html, which keeps the text.
  transformTags: {
    b: 'strong',
    i: 'em',
  },
  parser: { lowerCaseTags: true },
  enforceHtmlBoundary: true,
};

/**
 * Collapse the whitespace Word leaves behind once its markup is gone: runs of
 * non-breaking spaces, empty paragraphs, and the blank lines left where the
 * comment block used to be.
 */
function tidyWhitespace(html: string): string {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/<p>(\s|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br /><br />')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What gets written to job_postings.description. Safe to render with
 * dangerouslySetInnerHTML and safe to hand to the feed builder.
 */
export function sanitizeStoredDescription(input: string): string {
  if (!input) return '';
  return tidyWhitespace(sanitizeHtml(input, SANITIZE_OPTIONS));
}

/**
 * Indeed reads the feed as CDATA, so entities must arrive decoded — an escaped
 * "&amp;" would otherwise render literally on the listing page.
 */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * The exact string that ends up inside <description> in the Indeed XML feed.
 * The compliance checker is served this same value so that it grades what
 * Indeed actually receives.
 */
export function sanitizeFeedDescription(input: string): string {
  if (!input) return '';
  return decodeHtmlEntities(sanitizeStoredDescription(input)).trim();
}

/**
 * Visible text length, used to report how much of a stored description is
 * markup rather than content.
 */
export function visibleTextLength(html: string): number {
  return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;
}
