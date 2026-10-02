// Builds workflow/content-pack-workflow.json from the Code-node sources in src/nodes.
// Usage: node scripts/build-workflow.js   (or: npm run build)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NODES_DIR = path.join(__dirname, '..', 'src', 'nodes');
const code = (f) => fs.readFileSync(path.join(NODES_DIR, f), 'utf8');
// Deterministic IDs keep git diffs clean between builds
let idCounter = 0;
const id = () => {
  const h = crypto.createHash('sha1').update('content-pack-bot:' + idCounter++).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
};
const OUT = path.join(__dirname, '..', 'workflow', 'content-pack-workflow.json');

// --- syntax check of every Code node snippet ---
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
for (const f of fs.readdirSync(NODES_DIR)) {
  new AsyncFunction('$', '$input', '$prevNode', 'DateTime', code(f));
}

const str = (name, value) => ({ id: id(), name, value, type: 'string' });
const num = (name, value) => ({ id: id(), name, value, type: 'number' });

const ifBool = (expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

const switchRule = (key) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: id(), leftValue: '={{ $json.type }}', rightValue: key, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: key,
});

const tgSend = (chatId, text, extra = {}) => ({
  chatId,
  text,
  additionalFields: { appendAttribution: false, ...extra },
});

const OPENAI_AUTH = { authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi' };

const SHEET_COLUMNS = [
  ['თარიღი', 'date'],
  ['კლიენტი', 'client'],
  ['სტატუსი', 'status'],
  ['წყაროს ტიპი', 'source_type'],
  ['წყარო', 'source_ref'],
  ['შეჯამება', 'summary'],
  ['Instagram', 'instagram'],
  ['Facebook', 'facebook'],
  ['LinkedIn', 'linkedin'],
  ['Reels/TikTok იდეები', 'reels'],
  ['სათაურები', 'headlines'],
  ['ავტორი (Telegram)', 'requested_by'],
  ['წყაროს ტექსტი', 'source_excerpt'],
];

const N = (name, type, typeVersion, position, parameters, extra = {}) => ({
  parameters, id: id(), name, type, typeVersion, position, ...extra,
});

const nodes = [
  N('Telegram Trigger', 'n8n-nodes-base.telegramTrigger', 1.2, [-220, 300],
    { updates: ['message'], additionalFields: {} }, { webhookId: id() }),

  N('Settings', 'n8n-nodes-base.set', 3.4, [0, 300], {
    assignments: { assignments: [
      str('sheet_id', 'PASTE_GOOGLE_SHEET_ID'),
      str('sheet_tab', 'Content'),
      str('openai_model', 'gpt-4.1'),
      str('fallback_model', 'gpt-4.1'),
      str('reasoning_effort', 'medium'),
      str('transcription_model', 'gpt-4o-transcribe'),
      str('transcription_prompt', 'ქართულენოვანი ჩანაწერი მარკეტინგის, ბიზნესისა და სოციალური ქსელების შესახებ. გამართული ქართული მართლწერა და პუნქტუაცია.'),
      str('allowed_chat_ids', ''),
      num('max_file_mb', 20),
      num('max_source_chars', 12000),
    ] },
    options: {},
  }),

  N('Brand Profiles', 'n8n-nodes-base.code', 2, [220, 300], { jsCode: code('brand_profiles.js') }),
  N('Detect Input', 'n8n-nodes-base.code', 2, [440, 300], { jsCode: code('detect_input.js') }),
  N('Input OK?', 'n8n-nodes-base.if', 2.2, [660, 300], ifBool('={{ $json.ok }}')),

  N('Send Ack', 'n8n-nodes-base.telegram', 1.2, [900, 60],
    tgSend('={{ $json.chat_id }}',
      "=⏳ მივიღე: {{ $json.source_type }}\nვამზადებ კონტენტ-პაკეტს კლიენტისთვის „{{ $('Brand Profiles').first().json.client_name }}“ — ჩვეულებრივ 1–2 წუთი სჭირდება.",
      { reply_to_message_id: '={{ $json.message_id }}' }),
    { onError: 'continueRegularOutput' }),

  N('Route by Type', 'n8n-nodes-base.switch', 3.2, [900, 300], {
    rules: { values: [switchRule('media'), switchRule('url'), switchRule('text')] },
    options: {},
  }),

  // --- media ---
  N('Get Telegram File', 'n8n-nodes-base.telegram', 1.2, [1100, 100],
    { resource: 'file', operation: 'get', fileId: '={{ $json.file_id }}', download: true, additionalFields: {} },
    { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueErrorOutput' }),

  N('Fix Audio Filename', 'n8n-nodes-base.code', 2, [1280, 100], { jsCode: code('fix_audio_filename.js') }),

  N('Whisper Transcribe', 'n8n-nodes-base.httpRequest', 4.2, [1460, 100], {
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    ...OPENAI_AUTH,
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
      { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
      { parameterType: 'formData', name: 'model', value: "={{ $('Settings').first().json.transcription_model }}" },
      // `language=ka` API-ს არ აქვს მხარდაჭერილი — ენას prompt-ით ვკარნახობთ
      { parameterType: 'formData', name: 'prompt', value: "={{ $('Settings').first().json.transcription_prompt + ($('Brand Profiles').first().json.vocabulary ? ' ტერმინები: ' + $('Brand Profiles').first().json.vocabulary + '.' : '') }}" },
      { parameterType: 'formData', name: 'response_format', value: 'json' },
    ] },
    options: { timeout: 300000 },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueErrorOutput' }),

  N('Source: Transcript', 'n8n-nodes-base.set', 3.4, [1640, 100], {
    assignments: { assignments: [
      str('source_type', "={{ $('Detect Input').first().json.source_type }}"),
      str('source_ref', "={{ $('Detect Input').first().json.source_ref }}"),
      str('source_text', '={{ $json.text }}'),
      str('extra_context', "={{ $('Detect Input').first().json.extra_context }}"),
    ] },
    options: {},
  }),

  // --- url ---
  N('Fetch URL', 'n8n-nodes-base.httpRequest', 4.2, [1140, 300], {
    url: '={{ $json.url }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      { name: 'Accept-Language', value: 'ka,en;q=0.8' },
    ] },
    options: {
      timeout: 30000,
      response: { response: { responseFormat: 'text', outputPropertyName: 'html' } },
    },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueErrorOutput' }),

  N('Extract Article Text', 'n8n-nodes-base.code', 2, [1360, 300], { jsCode: code('extract_article.js') }),

  // --- text ---
  N('Source: Text', 'n8n-nodes-base.set', 3.4, [1140, 500], {
    assignments: { assignments: [
      str('source_type', '={{ $json.source_type }}'),
      str('source_ref', '={{ $json.source_ref }}'),
      str('source_text', '={{ $json.text }}'),
      str('extra_context', '={{ $json.extra_context }}'),
    ] },
    options: {},
  }),

  // --- AI ---
  N('Source OK?', 'n8n-nodes-base.if', 2.2, [1820, 300],
    ifBool("={{ !$json.error_message && String($json.source_text || '').trim().length >= 20 }}")),

  N('Build AI Request', 'n8n-nodes-base.code', 2, [2040, 280], { jsCode: code('build_ai_request.js') }),

  N('OpenAI Generate', 'n8n-nodes-base.httpRequest', 4.2, [2260, 280], {
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    ...OPENAI_AUTH,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}',
    options: { timeout: 180000 },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueErrorOutput' }),

  N('Parse AI Response', 'n8n-nodes-base.code', 2, [2480, 280],
    { jsCode: code('parse_ai_response.js') }, { onError: 'continueErrorOutput' }),

  // Mixed-in foreign script on the first attempt → ask the model once more
  N('Retry Needed?', 'n8n-nodes-base.if', 2.2, [2700, 260],
    ifBool('={{ $json.foreign_found === true && $runIndex === 0 }}')),
  N('Retry Request', 'n8n-nodes-base.code', 2, [2480, 60], { jsCode: code('retry_request.js') }),

  N('Save to Google Sheets', 'n8n-nodes-base.googleSheets', 4.5, [2920, 260], {
    operation: 'append',
    documentId: { __rl: true, value: "={{ $('Settings').first().json.sheet_id }}", mode: 'id' },
    sheetName: { __rl: true, value: "={{ $('Settings').first().json.sheet_tab }}", mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(SHEET_COLUMNS.map(([col, key]) => [col, `={{ $json.${key} }}`])),
      matchingColumns: [],
      schema: SHEET_COLUMNS.map(([col]) => ({
        id: col, displayName: col, required: false, defaultMatch: false,
        display: true, type: 'string', canBeUsedToMatch: true,
      })),
    },
    options: { cellFormat: 'RAW' },
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueErrorOutput' }),

  N('Send Summary', 'n8n-nodes-base.telegram', 1.2, [3140, 240],
    tgSend("={{ $('Parse AI Response').first(0).json.chat_id }}",
      "={{ $('Parse AI Response').first(0).json.telegram_text }}",
      { disable_web_page_preview: true, reply_to_message_id: "={{ $('Parse AI Response').first(0).json.message_id }}" })),

  // --- errors (in-flow) ---
  N('Prepare Error Message', 'n8n-nodes-base.code', 2, [2260, 700], { jsCode: code('prepare_error.js') }),
  N('Send Error Message', 'n8n-nodes-base.telegram', 1.2, [2480, 700],
    tgSend('={{ $json.chat_id }}', '={{ $json.text }}', { reply_to_message_id: '={{ $json.message_id }}' }),
    { onError: 'continueRegularOutput' }),

  // --- errors (global) ---
  N('Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [-220, 1000], {}),
  N('Format Admin Alert', 'n8n-nodes-base.code', 2, [0, 1000], { jsCode: code('format_admin_alert.js') }),
  N('Notify Admin', 'n8n-nodes-base.telegram', 1.2, [220, 1000],
    tgSend('={{ $json.chat_id }}', '={{ $json.text }}')),

  // --- sticky notes ---
  N('Note: Setup', 'n8n-nodes-base.stickyNote', 1, [-280, -320], {
    content: [
      '## 📦 Content Pack Bot — დაყენება',
      '1. **Credentials:** Telegram (ყველა Telegram ნოდი), OpenAI (Whisper Transcribe, OpenAI Generate), Google Sheets (Save to Google Sheets).',
      '2. **Settings:** ჩასვი `sheet_id` და (სურვილისამებრ) `allowed_chat_ids`.',
      '3. **Brand Profiles:** აქ არის თითოეული კლიენტის brand voice. Telegram-ში `#cafe`-ით ირჩევ კლიენტს.',
      '4. **Format Admin Alert:** ჩასვი ადმინის chat ID.',
      '5. **Workflow Settings → Error Workflow:** აირჩიე ეს workflow.',
      '6. გაააქტიურე (Active).',
    ].join('\n'),
    height: 300, width: 680, color: 4,
  }),
  N('Note: Errors', 'n8n-nodes-base.stickyNote', 1, [-280, 880], {
    content: '## 🚨 გლობალური შეცდომები\nმუშაობს მხოლოდ აქტიური (production) გაშვებისას, როცა ეს workflow არჩეულია Settings → Error Workflow-ში. შეტყობინება მიდის ადმინთან.',
    height: 300, width: 680, color: 3,
  }),
  N('Note: In-flow errors', 'n8n-nodes-base.stickyNote', 1, [2200, 600], {
    content: '## ⚠️ მოსალოდნელი შეცდომები\nყველა წითელი (error) გამოსავალი აქ მოდის → მომხმარებელს გასაგები ქართული შეტყობინება.',
    height: 260, width: 520, color: 3,
  }),
];

const main = (...outputs) => ({ main: outputs.map(targets => targets.map(node => ({ node, type: 'main', index: 0 }))) });
const ERR = 'Prepare Error Message';

const connections = {
  'Telegram Trigger': main(['Settings']),
  'Settings': main(['Brand Profiles']),
  'Brand Profiles': main(['Detect Input']),
  'Detect Input': main(['Input OK?']),
  'Input OK?': main(['Send Ack', 'Route by Type'], [ERR]),
  'Route by Type': main(['Get Telegram File'], ['Fetch URL'], ['Source: Text']),
  'Get Telegram File': main(['Fix Audio Filename'], [ERR]),
  'Fix Audio Filename': main(['Whisper Transcribe']),
  'Whisper Transcribe': main(['Source: Transcript'], [ERR]),
  'Source: Transcript': main(['Source OK?']),
  'Fetch URL': main(['Extract Article Text'], [ERR]),
  'Extract Article Text': main(['Source OK?']),
  'Source: Text': main(['Source OK?']),
  'Source OK?': main(['Build AI Request'], [ERR]),
  'Build AI Request': main(['OpenAI Generate']),
  'OpenAI Generate': main(['Parse AI Response'], [ERR]),
  'Parse AI Response': main(['Retry Needed?'], [ERR]),
  'Retry Needed?': main(['Retry Request'], ['Save to Google Sheets']),
  'Retry Request': main(['OpenAI Generate']),
  'Save to Google Sheets': main(['Send Summary'], [ERR]),
  [ERR]: main(['Send Error Message']),
  'Error Trigger': main(['Format Admin Alert']),
  'Format Admin Alert': main(['Notify Admin']),
};

// sanity: every connection target exists
const names = new Set(nodes.map(n => n.name));
for (const [src, { main: outs }] of Object.entries(connections)) {
  if (!names.has(src)) throw new Error('missing source ' + src);
  for (const o of outs) for (const t of o) if (!names.has(t.node)) throw new Error('missing target ' + t.node);
}

const workflow = {
  id: 'CntPackBotKa2026',
  name: 'Content Pack Bot (Telegram → AI → Sheets)',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', timezone: 'Asia/Tbilisi', saveManualExecutions: true },
  meta: { templateCredsSetupCompleted: false },
};

fs.writeFileSync(OUT, JSON.stringify(workflow, null, 2), 'utf8');
console.log('OK', nodes.length, 'nodes ->', path.relative(process.cwd(), OUT));

