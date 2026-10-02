// OpenAI პასუხის პარსინგი, ვალიდაცია და Sheets/Telegram-ისთვის მომზადება
const s = $('Settings').first().json;
const b = $('Brand Profiles').first().json;
const d = $('Detect Input').first().json;
const src = $('Build AI Request').first().json;
const res = $input.first().json;

const choice = res.choices?.[0];
if (!choice) throw new Error('OpenAI-მ ცარიელი პასუხი დააბრუნა');
if (choice.message?.refusal) throw new Error('მოდელმა უარი თქვა: ' + choice.message.refusal);
if (choice.finish_reason === 'length') throw new Error('პასუხი შუაში გაწყდა (token limit) — შეამცირე max_source_chars');

let data;
try {
  data = JSON.parse(choice.message.content);
} catch (e) {
  throw new Error('AI-ს პასუხი არ არის ვალიდური JSON: ' + e.message);
}

// AI-მ წყარო გაუგებრად შეაფასა (მაგ. ცუდი ტრანსკრიფცია) — კონტენტს არ ვქმნით
if (data.source_quality === 'unclear') throw new Error('UNCLEAR_SOURCE');

// მოდელი ზოგჯერ ურევს სხვა დამწერლობის ასოებს: „кафეში“, „ലეპტოპს“ (მალაიალამური ല ≈ ლ), „გახსნის দিনে“.
// დასაშვებია მხოლოდ ქართული და ლათინური. პირველ ცდაზე → Retry Needed? თავიდან ჰკითხავს მოდელს.
// მეორე ცდის შემდეგ: ქართულ სიტყვაში ჩაჯდომილ ასოებს ვასწორებთ (კირილიცა → ქართული, მსგავსი ასოები),
// ცალკე მდგომ უცხო სიტყვებს ვშლით — და რედაქტორს ვაფრთხილებთ.
const FOREIGN = /(?:(?![\p{Script=Georgian}\p{Script=Latin}])\p{L}\p{M}*)+/gu;
const CYRILLIC = { а: 'ა', б: 'ბ', в: 'ვ', г: 'გ', д: 'დ', е: 'ე', ё: 'იო', ж: 'ჟ', з: 'ზ', и: 'ი', й: 'ი', к: 'კ', л: 'ლ', м: 'მ', н: 'ნ', о: 'ო', п: 'პ', р: 'რ', с: 'ს', т: 'ტ', у: 'უ', ф: 'ფ', х: 'ხ', ц: 'ც', ч: 'ჩ', ш: 'შ', щ: 'შჩ', ъ: '', ы: 'ი', ь: '', э: 'ე', ю: 'იუ', я: 'ია' };
const LOOKALIKE = { 'ല': 'ლ', 'ര': 'რ', 'ന': 'ნ', 'സ': 'ს' };
const GEO = /\p{Script=Georgian}/u;
const toGeorgian = (run) => {
  const out = [...run.toLowerCase()].map(ch => CYRILLIC[ch] ?? LOOKALIKE[ch] ?? null);
  return out.includes(null) ? null : out.join('');
};
let foreignFound = false;
const str = (v) => {
  if (typeof v !== 'string') return '';
  const cleaned = v.replace(FOREIGN, (run, offset, all) => {
    foreignFound = true;
    const gluedToGeorgian = GEO.test(all[offset - 1] || '') || GEO.test(all[offset + run.length] || '');
    const fixed = gluedToGeorgian ? toGeorgian(run) : null;
    return fixed ?? '';
  });
  return cleaned.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
};
const arr = (v) => (Array.isArray(v) ? v : []);

const missing = Object.entries({
  'instagram.caption': data.instagram?.caption,
  'facebook.post': data.facebook?.post,
  'linkedin.post': data.linkedin?.post,
}).filter(([, v]) => !str(v)).map(([k]) => k);
if (missing.length) throw new Error('JSON-ში აკლია ველები: ' + missing.join(', '));

const hashtags = [...new Set(
  arr(data.instagram.hashtags)
    .map(h => '#' + str(String(h)).replace(/^[\s#]+/, '').replace(/\s+/g, ''))
    .filter(h => h.length > 1)
)].slice(0, 5);
const reels = arr(data.reels_ideas).filter(r => str(r?.hook) || str(r?.script)).slice(0, 3);
const headlines = arr(data.headlines).map(str).filter(Boolean).slice(0, 5);

const warnings = [];
if (hashtags.length < 5) warnings.push(`ჰეშთეგი ${hashtags.length}/5`);
if (reels.length < 3) warnings.push(`Reels იდეა ${reels.length}/3`);
if (headlines.length < 5) warnings.push(`სათაური ${headlines.length}/5`);

// ყველა ტექსტური ველი str()-ით სუფთავდება აქ, warnings-მდე — ასე foreignFound ზუსტია
const summary = str(data.summary);
const caption = str(data.instagram.caption);
const facebook = str(data.facebook.post);
const linkedin = str(data.linkedin.post);
const reelsCell = reels
  .map((r, i) => `🎬 იდეა ${i + 1}\nჰუკი: ${str(r.hook)}\nსცენარი:\n${str(r.script)}`)
  .join('\n\n———\n\n');
if (foreignFound) warnings.push('ორი ცდის შემდეგაც გაერია სხვა დამწერლობის ასოები — ავტომატურად გასწორდა, გადაამოწმე წინადადებები');

const date = DateTime.now().setZone('Asia/Tbilisi').toFormat('yyyy-MM-dd HH:mm');
const sheetUrl = `https://docs.google.com/spreadsheets/d/${s.sheet_id}/edit`;

const instagram = `${caption}\n\n${hashtags.join(' ')}`;
const headlinesCell = headlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

const telegramText = [
  '✅ კონტენტ-პაკეტი მზადაა!',
  '',
  `🏷 კლიენტი: ${b.client_name}`,
  `📥 წყარო: ${d.source_type}`,
  `📝 მთავარი აზრი: ${summary}`,
  '',
  '📌 სათაურის ვარიანტები:',
  headlinesCell,
  '',
  `📦 პაკეტში: Instagram (+${hashtags.length} ჰეშთეგი) • Facebook • LinkedIn • ${reels.length} Reels/TikTok იდეა • ${headlines.length} სათაური`,
  warnings.length ? `⚠️ შეამოწმე: ${warnings.join(', ')}` : null,
  '🟡 სტატუსი: დასამტკიცებელი',
  '',
  `🔗 Google Sheets: ${sheetUrl}`,
].filter(l => l !== null).join('\n').slice(0, 4000);

return [{
  json: {
    // Google Sheets სვეტები
    date,
    client: b.client_name,
    status: 'დასამტკიცებელი',
    source_type: d.source_type,
    source_ref: src.source_ref,
    summary,
    instagram,
    facebook,
    linkedin,
    reels: reelsCell,
    headlines: headlinesCell,
    requested_by: d.user,
    source_excerpt: String(src.source_text || '').slice(0, 3000),
    // Telegram
    chat_id: d.chat_id,
    message_id: d.message_id,
    telegram_text: telegramText,
    sheet_url: sheetUrl,
    // Retry Needed? კითხულობს: true → OpenAI-ს ერთხელ თავიდან ვეკითხებით
    foreign_found: foreignFound,
  },
}];
