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

// მოდელი იშვიათად ურევს უცხო დამწერლობის სიტყვებს (მაგ. 週末) — ვშლით და ვაფრთხილებთ
const FOREIGN = /[฀-๿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]+/g;
let foreignFound = false;
const str = (v) => {
  if (typeof v !== 'string') return '';
  const cleaned = v.replace(FOREIGN, () => { foreignFound = true; return ''; });
  return cleaned.replace(/[ \t]{2,}/g, ' ').trim();
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
    .map(h => '#' + String(h).replace(/^[\s#]+/, '').replace(/\s+/g, ''))
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
if (foreignFound) warnings.push('ტექსტიდან ამოიშალა უცხო დამწერლობის სიმბოლოები — გადაამოწმე წინადადებები');

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
  },
}];
