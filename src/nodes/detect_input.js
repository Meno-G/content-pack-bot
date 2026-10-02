// შემოსული შეტყობინების ტიპის დადგენა: media | url | text
// (ან შეცდომა: forbidden | help | too_large | unsupported_url | too_short | unsupported)
const s = $('Settings').first().json;
const brand = $('Brand Profiles').first().json;
const msg = $('Telegram Trigger').first().json.message || {};

const out = {
  ok: false,
  chat_id: msg.chat?.id,
  message_id: msg.message_id,
  user: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || '',
  type: '',
  source_type: '',
  source_ref: '',
  text: '',
  extra_context: '',
  url: '',
  file_id: '',
  error_message: '',
};
const fail = (type, message) => {
  out.type = type;
  out.error_message = message;
  return [{ json: out }];
};

// 1) წვდომის კონტროლი (Settings → allowed_chat_ids; ცარიელი = ყველას შეუძლია)
const allowed = String(s.allowed_chat_ids || '').split(',').map(x => x.trim()).filter(Boolean);
if (allowed.length && !allowed.includes(String(out.chat_id))) {
  return fail('forbidden', `⛔ ამ ბოტის გამოყენების უფლება არ გაქვს.\nშენი Chat ID: ${out.chat_id}\nგადაეცი ადმინისტრატორს, რომ სიაში დაგამატოს.`);
}

// 2) ტექსტი ან caption (ბრენდის #ტეგი იჭრება)
let raw = String(msg.text ?? msg.caption ?? '').trim();
if (brand.brand_tag && raw.startsWith(brand.brand_tag)) raw = raw.slice(brand.brand_tag.length).trim();

// 3) ბრძანებები
if (/^\/(start|help)\b/i.test(raw)) {
  return fail('help', [
    '👋 გამარჯობა! ერთი წყაროდან ვამზადებ სოციალური ქსელების კონტენტ-პაკეტს:',
    'Instagram, Facebook, LinkedIn, 3 Reels/TikTok იდეა და 5 სათაური.',
    '',
    'გამომიგზავნე:',
    '• ვიდეო, ვიდეო-რგოლი, ხმოვანი შეტყობინება ან აუდიო (მაქს. 20 MB)',
    '• სტატიის ლინკი',
    '• სტატიის ტექსტი ან ბრენდის მოკლე შეტყობინება',
    '',
    `კლიენტის ასარჩევად დასაწყისში დაწერე მისი ტეგი: ${brand.available_brands}`,
    'ფაილს caption-ში შეგიძლია მიუწერო მითითებაც, მაგ.: „აქცენტი გააკეთე ფასდაკლებაზე“.',
  ].join('\n'));
}

// 4) ვიდეო / აუდიო / ხმოვანი
const doc = msg.document;
const docIsMedia = Boolean(doc && /^(audio|video)\//i.test(doc.mime_type || ''));
const media = msg.voice || msg.audio || msg.video || msg.video_note || (docIsMedia ? doc : null);
if (media) {
  const kind = msg.voice ? 'ხმოვანი შეტყობინება'
    : msg.audio ? 'აუდიო'
    : msg.video ? 'ვიდეო'
    : msg.video_note ? 'ვიდეო-რგოლი'
    : /^video/i.test(doc.mime_type) ? 'ვიდეო (ფაილი)' : 'აუდიო (ფაილი)';
  const sizeMb = (media.file_size || 0) / 1048576;
  if (sizeMb > Number(s.max_file_mb || 20)) {
    return fail('too_large', `📦 ფაილი ძალიან დიდია (${sizeMb.toFixed(1)} MB).\nTelegram ბოტს მაქსიმუმ 20 MB ფაილის ჩამოტვირთვა შეუძლია.\nგამოგზავნე უფრო მოკლე ფრაგმენტი, დაბალი ხარისხის ვიდეო ან მხოლოდ აუდიო (mp3/m4a).`);
  }
  const dur = media.duration ? ` (${Math.floor(media.duration / 60)}:${String(media.duration % 60).padStart(2, '0')})` : '';
  Object.assign(out, {
    ok: true,
    type: 'media',
    source_type: kind,
    source_ref: `${kind}${dur}${media.file_name ? ' — ' + media.file_name : ''}`,
    file_id: media.file_id,
    extra_context: raw,
  });
  return [{ json: out }];
}

// 5) ლინკი (თუ ლინკის გარდა ტექსტი მცირეა — ვამუშავებთ როგორც ლინკს)
const urlMatch = raw.match(/https?:\/\/[^\s<>"]+/i);
if (urlMatch) {
  const url = urlMatch[0].replace(/[.,;:!?)\]]+$/, '');
  const rest = raw.replace(urlMatch[0], '').trim();
  if (rest.length < 300) {
    if (/(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.watch)/i.test(url)) {
      return fail('unsupported_url', '🔗 ამ პლატფორმის ლინკიდან კონტენტს ვერ ვიღებ (YouTube/Instagram/TikTok/Facebook).\nგადმოწერე ვიდეო და გამომიგზავნე ფაილად (მაქს. 20 MB), ან ჩააკოპირე ტექსტი.');
    }
    Object.assign(out, {
      ok: true,
      type: 'url',
      source_type: 'ლინკი',
      source_ref: url,
      url,
      extra_context: rest,
    });
    return [{ json: out }];
  }
}

// 6) ტექსტი
if (raw.length >= 20) {
  Object.assign(out, {
    ok: true,
    type: 'text',
    source_type: raw.length > 600 ? 'სტატიის ტექსტი' : 'მოკლე შეტყობინება',
    source_ref: raw.slice(0, 120) + (raw.length > 120 ? '…' : ''),
    text: raw,
  });
  return [{ json: out }];
}
if (raw.length > 0) {
  return fail('too_short', '✂️ ტექსტი ძალიან მოკლეა. დაწერე მინიმუმ ერთი-ორი წინადადება: რა გინდა, რომ ვთქვათ, ვისთვის და რატომ.');
}
return fail('unsupported', '🤔 ამ ტიპის შეტყობინებას ვერ ვამუშავებ.\nგამომიგზავნე ტექსტი, ლინკი, ვიდეო, ხმოვანი ან აუდიო ფაილი.\n/help — დახმარება');
