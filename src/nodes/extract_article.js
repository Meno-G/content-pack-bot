// HTML-დან სტატიის სუფთა ტექსტის ამოღება
const s = $('Settings').first().json;
const d = $('Detect Input').first().json;
const html = String($input.first().json.html || '');

const decode = (t = '') => t
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»').replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&hellip;/gi, '…')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

const meta = (name) => {
  const tag = (html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*>`, 'i')) || [''])[0];
  const c = tag.match(/content=(?:"([^"]*)"|'([^']*)')/i);
  return c ? decode(c[1] ?? c[2]).trim() : '';
};

const clean = (h) => decode(h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\f\v\r]+/g, ' ')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length >= 25) // მენიუს, ღილაკების და სხვა მოკლე ხაზების მოშორება
  .join('\n');

const all = (re) => [...html.matchAll(re)].map(m => m[1]);
const candidates = [
  ...all(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
  ...all(/<main\b[^>]*>([\s\S]*?)<\/main>/gi),
  ...all(/<body\b[^>]*>([\s\S]*?)<\/body>/gi),
].map(clean);

const body = candidates.find(t => t.length >= 800)
  || candidates.sort((a, b) => b.length - a.length)[0]
  || clean(html);

const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
const title = meta('og:title') || decode(titleTag).trim();
const description = meta('og:description') || meta('description');

const text = [
  title && `სათაური: ${title}`,
  description && `აღწერა: ${description}`,
  body,
].filter(Boolean).join('\n\n').slice(0, Number(s.max_source_chars || 12000));

const tooShort = body.length < 200;

return [{
  json: {
    source_type: d.source_type,
    source_ref: d.url,
    source_text: tooShort ? '' : text,
    extra_context: d.extra_context,
    error_message: tooShort
      ? '🌐 ლინკიდან სტატიის ტექსტი ვერ ამოვიღე — საიტი ან JavaScript-ით იტვირთება, ან დაცულია (paywall/ავტორიზაცია).\nჩააკოპირე სტატიის ტექსტი და გამომიგზავნე პირდაპირ.'
      : '',
  },
}];
