// ყველა მოსალოდნელი შეცდომა აქ იყრის თავს → მომხმარებელს გასაგები შეტყობინება
const d = $('Detect Input').first().json;
const item = $input.first().json;

const MESSAGES = {
  'Get Telegram File': '📥 Telegram-იდან ფაილის ჩამოტვირთვა ვერ მოხერხდა. სცადე თავიდან ან გამოგზავნე უფრო პატარა ფაილი (მაქს. 20 MB).',
  'Whisper Transcribe': '🎙 აუდიოს ტრანსკრიფცია ვერ მოხერხდა. შეამოწმე, რომ ფაილს ხმა აქვს და ფორმატი სტანდარტულია (mp4, mp3, m4a, ogg, wav).',
  'Fetch URL': '🌐 ლინკი ვერ გაიხსნა (საიტი მიუწვდომელია, ბოტებს ბლოკავს ან მისამართი არასწორია). ჩააკოპირე სტატიის ტექსტი და გამომიგზავნე პირდაპირ.',
  'Source OK?': '✂️ წყაროდან საკმარისი ტექსტი ვერ მივიღე (ტრანსკრიპტი ან ტექსტი ცარიელია ან ძალიან მოკლეა). სცადე სხვა ფაილი ან დაწერე ტექსტი.',
  'OpenAI Generate': '🤖 AI სერვისმა პასუხი ვერ დააბრუნა (ლიმიტი, ბალანსი ან დროებითი ხარვეზი). სცადე რამდენიმე წუთში.',
  'Parse AI Response': '🤖 AI-მ არასრული ან არასწორი ფორმატის პასუხი დააბრუნა. გამომიგზავნე იგივე წყარო თავიდან.',
  'Save to Google Sheets': '📊 კონტენტი მზადაა, მაგრამ Google Sheets-ში ჩაწერა ვერ მოხერხდა (შეამოწმე ცხრილის ID, ფურცლის სახელი და წვდომა). კონტენტს აქვე გიგზავნი:',
};

let prev = '';
try { prev = $prevNode.name; } catch (e) { /* ძველ ვერსიებში $prevNode შეიძლება არ იყოს */ }

const technical = typeof item.error === 'string'
  ? item.error
  : (item.error?.message || item.error?.description || '');

let text = item.error_message || MESSAGES[prev] || '⚠️ მოულოდნელი შეცდომა მოხდა. სცადე თავიდან.';
if (String(technical).includes('UNCLEAR_SOURCE')) {
  text = '🎧 წყაროს ტექსტი გაუგებარი გამოვიდა (ხმაურიანი ან ცუდი ხარისხის ჩანაწერი, ან ტრანსკრიფცია ვერ მოხერხდა), ამიტომ კონტენტი არ შევქმენი — რომ არაფერი მოვიგონო.\nსცადე უფრო მკაფიო ჩანაწერი, ან გამომიგზავნე ტექსტად.';
} else if (!item.error_message && technical) {
  text += `\n\nℹ️ დეტალი: ${String(technical).slice(0, 300)}`;
}

// Sheets-ის შეცდომისას კონტენტი არ იკარგება — პირდაპირ Telegram-ში იგზავნება
if (prev === 'Save to Google Sheets') {
  // first(0) — Parse AI Response-ის success გამოსავალი (error გამოსავალიც აქ არის მიერთებული)
  const p = $('Parse AI Response').first(0).json;
  text += [
    '', '',
    '📸 INSTAGRAM', p.instagram, '',
    '📘 FACEBOOK', p.facebook, '',
    '💼 LINKEDIN', p.linkedin, '',
    '🎬 REELS/TIKTOK', p.reels, '',
    '📌 სათაურები', p.headlines,
  ].join('\n');
}

return [{
  json: {
    chat_id: d.chat_id,
    message_id: d.message_id,
    text: text.slice(0, 4000), // Telegram-ის ლიმიტი 4096 სიმბოლოა
  },
}];
