import {
  sanitizeStoredDescription,
  sanitizeFeedDescription,
  visibleTextLength,
} from '../jobDescription';

// Reproduction of the payload reported on job posting 20 ("Assistant Store
// Manager Milano"): Word pasted its conditional-comment block into the editor,
// which stored 37,138 characters for 3,207 characters of visible text.
const WORD_PASTE = `<!--[if gte mso 9]><xml>
 <w:WordDocument><w:View>Normal</w:View></w:WordDocument>
 <w:LatentStyles DefLockedState="false">
  <w:LsdException Locked="false" Priority="0" Name="Normal"/>
  <w:LsdException Locked="false" Priority="9" Name="heading 1"/>
 </w:LatentStyles>
 <m:mathPr><m:brkBinSub m:val="&#8722;&#8722;"/></m:mathPr>
</xml><![endif]-->
<style><!-- p.MsoNormal {mso-style-parent:""; font-size:12.0pt;} --></style>
<p class="MsoNormal" style="margin:0cm"><b><span lang="IT">Assistant Store Manager</span></b></p>
<p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<ul><li style="mso-list:l0"><i>Gestione</i> del punto vendita &amp; del team</li></ul>`;

// The check that flagged the posting as "Action Required" in the UI.
const D4_ENTITY_CHECK = /&amp;|&lt;|&gt;|&quot;|&#/i;

describe('sanitizeStoredDescription', () => {
  it('drops the Office conditional-comment block, including w: and m: markup', () => {
    const cleaned = sanitizeStoredDescription(WORD_PASTE);

    expect(cleaned).not.toMatch(/LsdException/i);
    expect(cleaned).not.toMatch(/brkBinSub/i);
    expect(cleaned).not.toMatch(/WordDocument/i);
    expect(cleaned).not.toContain('<!--');
    expect(cleaned).not.toMatch(/mso/i);
  });

  it('keeps only the agreed tags and normalises b/i to strong/em', () => {
    const cleaned = sanitizeStoredDescription(WORD_PASTE);

    expect(cleaned).toContain('<strong>Assistant Store Manager</strong>');
    expect(cleaned).toContain('<em>Gestione</em>');
    expect(cleaned).toContain('<ul>');
    expect(cleaned).toContain('<li>');
    expect(cleaned).not.toMatch(/<span|<div|<font|class=|style=/i);
  });

  it('preserves the visible text while removing the markup bulk', () => {
    const cleaned = sanitizeStoredDescription(WORD_PASTE);

    // Markup bulk collapses, visible text survives intact. Measured on the feed
    // string, where entities are decoded — the stored value keeps "&amp;".
    expect(cleaned.length).toBeLessThan(WORD_PASTE.length / 2);
    expect(visibleTextLength(sanitizeFeedDescription(WORD_PASTE))).toBe(
      'Assistant Store Manager Gestione del punto vendita & del team'.length,
    );
    expect(cleaned).toContain('Assistant Store Manager');
    expect(cleaned).toContain('Gestione');
    expect(cleaned).toContain('del punto vendita');
  });

  it('is idempotent, so re-saving a cleaned posting changes nothing', () => {
    const once = sanitizeStoredDescription(WORD_PASTE);
    expect(sanitizeStoredDescription(once)).toBe(once);
  });

  it('strips scripts, so a description cannot inject markup into the careers page', () => {
    const cleaned = sanitizeStoredDescription('<p>Ciao</p><script>alert(1)</script><img src=x onerror=alert(1)>');

    expect(cleaned).not.toMatch(/script|onerror|<img/i);
    expect(cleaned).toContain('<p>Ciao</p>');
  });

  it('returns an empty string for empty input rather than throwing', () => {
    expect(sanitizeStoredDescription('')).toBe('');
  });
});

describe('sanitizeFeedDescription', () => {
  it('passes the entity check that the raw stored value fails', () => {
    // This is the reported bug in one assertion: the stored string trips D4,
    // the string Indeed is actually served does not.
    expect(D4_ENTITY_CHECK.test(WORD_PASTE)).toBe(true);
    expect(D4_ENTITY_CHECK.test(sanitizeFeedDescription(WORD_PASTE))).toBe(false);
  });

  it('decodes entities so ampersands render correctly on the listing', () => {
    const feed = sanitizeFeedDescription('<p>Vendita &amp; assistenza</p>');

    expect(feed).toContain('Vendita & assistenza');
    expect(feed).not.toContain('&amp;');
  });

  it('still produces valid, structured HTML for Indeed', () => {
    const feed = sanitizeFeedDescription(WORD_PASTE);

    expect(feed).toMatch(/<p>|<ul>/);
    expect(feed).toContain('Assistant Store Manager');
  });
});
