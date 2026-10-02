// Unit tests for the n8n Code-node sources in src/nodes.
// n8n globals ($, $input, $prevNode, DateTime) are mocked, so the tests run with plain Node.js:
//   node --test tests/      (or: npm test)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'nodes', file), 'utf8');
const DateTime = { now: () => ({ setZone: () => ({ toFormat: () => '2026-10-02 12:00' }) }) };

/** Run one Code node: `nodes` = outputs of previously executed nodes, `input` = this node's input item. */
async function runNode(file, { nodes = {}, input = {}, prevNode = 'X', binary } = {}) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`node not executed: ${name}`);
    return { first: () => ({ json: nodes[name] }) };
  };
  const $input = { first: () => ({ json: input, binary }) };
  const out = await new AsyncFunction('$', '$input', '$prevNode', 'DateTime', source(file))($, $input, { name: prevNode }, DateTime);
  return out[0];
}

const SETTINGS = { sheet_id: 'SHEET', allowed_chat_ids: '', max_file_mb: 20, max_source_chars: 12000, openai_model: 'gpt-5', reasoning_effort: 'low' };

async function detect(message, settings = SETTINGS) {
  const brand = (await runNode('brand_profiles.js', { nodes: { 'Telegram Trigger': { message } } })).json;
  const det = (await runNode('detect_input.js', { nodes: { Settings: settings, 'Brand Profiles': brand, 'Telegram Trigger': { message } } })).json;
  return { brand, det };
}

const aiResponse = (data) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
const validPack = (overrides = {}) => ({
  source_quality: 'ok',
  summary: 'მთავარი აზრი',
  instagram: { caption: 'Instagram ტექსტი', hashtags: ['ყავა', '#coffee', '# tbilisi cafe', '#ყავა', '#autumn', '#extra'] },
  facebook: { post: 'Facebook ტექსტი' },
  linkedin: { post: 'LinkedIn ტექსტი' },
  reels_ideas: [1, 2, 3].map((i) => ({ hook: `ჰუკი ${i}`, script: `სცენარი ${i}` })),
  headlines: ['1', '2', '3', '4', '5', '6'],
  ...overrides,
});
const PARSE_NODES = {
  Settings: SETTINGS,
  'Brand Profiles': { client_name: 'Client' },
  'Detect Input': { source_type: 'ტექსტი', user: 'U', chat_id: 1, message_id: 2 },
  'Build AI Request': { source_ref: 'ref', source_text: 'source' },
};
const parse = (data) => runNode('parse_ai_response.js', { nodes: PARSE_NODES, input: aiResponse(data) });

// ---------------------------------------------------------------- input detection
test('routes each Telegram message type correctly', async () => {
  const cases = [
    [{ text: '/start' }, 'help'],
    [{ text: 'ოქტომბრიდან მენიუში გვაქვს გოგრის ლატე.' }, 'text'],
    [{ text: 'https://example.com/article' }, 'url'],
    [{ text: 'https://youtu.be/abc' }, 'unsupported_url'],
    [{ voice: { file_id: 'F', duration: 75, file_size: 300000 } }, 'media'],
    [{ video: { file_id: 'F', file_size: 30 * 1048576 } }, 'too_large'],
    [{ sticker: {} }, 'unsupported'],
    [{ text: 'მოკლე' }, 'too_short'],
  ];
  for (const [msg, expected] of cases) {
    const { det } = await detect({ chat: { id: 1 }, message_id: 5, ...msg });
    assert.equal(det.type, expected, JSON.stringify(msg));
  }
});

test('brand tag selects the profile and is stripped from the text', async () => {
  const { brand, det } = await detect({ chat: { id: 1 }, message_id: 5, text: '#cafe ახალი სეზონური მენიუ ოქტომბრიდან' });
  assert.equal(brand.brand_key, 'cafe');
  assert.ok(brand.vocabulary.length > 0);
  assert.equal(det.text, 'ახალი სეზონური მენიუ ოქტომბრიდან');
});

test('link with a short comment keeps the comment as extra context', async () => {
  const { det } = await detect({ chat: { id: 1 }, message_id: 5, text: 'https://example.com/a. აქცენტი ციფრებზე' });
  assert.equal(det.url, 'https://example.com/a');
  assert.equal(det.extra_context, 'აქცენტი ციფრებზე');
});

test('allowlist blocks unknown chats and shows them their chat ID', async () => {
  const { det } = await detect({ chat: { id: 999 }, message_id: 5, text: 'გამარჯობა, ეს ტესტია' }, { ...SETTINGS, allowed_chat_ids: '1, 2' });
  assert.equal(det.type, 'forbidden');
  assert.match(det.error_message, /999/);
});

// ---------------------------------------------------------------- article extraction
test('extracts article text and drops scripts, navigation and entities', async () => {
  const html = `<html><head><meta property="og:title" content="სათაური"></head><body>
    <nav>მენიუ მენიუ მენიუ მენიუ მენიუ მენიუ</nav>
    <article><p>${'სტატიის აბზაცი &amp; ტექსტი&hellip; '.repeat(30)}</p><script>var bad = "არ უნდა ჩანდეს";</script></article>
  </body></html>`;
  const out = (await runNode('extract_article.js', {
    nodes: { Settings: SETTINGS, 'Detect Input': { url: 'https://e.com', source_type: 'ლინკი', extra_context: '' } },
    input: { html },
  })).json;
  assert.equal(out.error_message, '');
  assert.match(out.source_text, /სათაური: სათაური/);
  assert.ok(out.source_text.includes('& ტექსტი…'));
  assert.ok(!out.source_text.includes('არ უნდა ჩანდეს'));
  assert.ok(!out.source_text.includes('მენიუ მენიუ'));
});

test('JavaScript-only pages produce a helpful error instead of empty content', async () => {
  const out = (await runNode('extract_article.js', {
    nodes: { Settings: SETTINGS, 'Detect Input': { url: 'https://spa.example', source_type: 'ლინკი' } },
    input: { html: '<html><body><div id="root"></div></body></html>' },
  })).json;
  assert.equal(out.source_text, '');
  assert.match(out.error_message, /JavaScript/);
});

// ---------------------------------------------------------------- AI request
test('reasoning models get reasoning_effort, others get temperature; vocabulary reaches the prompt', async () => {
  const brand = { client_name: 'Law', vocabulary: 'ანაზღაურებადი შვებულება' };
  for (const [model, hasTemp] of [['gpt-5', false], ['gpt-4.1', true]]) {
    const { body } = (await runNode('build_ai_request.js', {
      nodes: { Settings: { ...SETTINGS, openai_model: model }, 'Brand Profiles': brand },
      input: { source_text: 'x' },
    })).json;
    assert.equal('temperature' in body, hasTemp, model);
    assert.equal('reasoning_effort' in body, !hasTemp, model);
    assert.ok(body.messages[0].content.includes('ანაზღაურებადი შვებულება'));
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(body.response_format.json_schema.schema.required.includes('source_quality'));
  }
});

// ---------------------------------------------------------------- AI response parsing
test('normalises hashtags and trims lists to the required counts', async () => {
  const out = (await parse(validPack())).json;
  assert.equal(out.instagram.split('\n\n').pop(), '#ყავა #coffee #tbilisicafe #autumn #extra');
  assert.equal(out.headlines.split('\n').length, 5);
  assert.equal(out.status, 'დასამტკიცებელი');
  assert.ok(!out.telegram_text.includes('⚠️'));
});

test('warns in Telegram when the model returns too few items', async () => {
  const out = (await parse(validPack({ reels_ideas: [{ hook: 'h', script: 's' }] }))).json;
  assert.match(out.telegram_text, /Reels იდეა 1\/3/);
});

test('strips foreign-script tokens (e.g. 週末) and warns the editor', async () => {
  const out = (await parse(validPack({ linkedin: { post: 'კონტექსტი:週末 შეხვედრები' } }))).json;
  assert.equal(out.linkedin, 'კონტექსტი: შეხვედრები');
  assert.match(out.telegram_text, /უცხო დამწერლობის/);
});

test('refuses to build content from an unclear source', async () => {
  await assert.rejects(parse(validPack({ source_quality: 'unclear' })), /UNCLEAR_SOURCE/);
});

test('rejects truncated or invalid model output', async () => {
  const truncated = { choices: [{ finish_reason: 'length', message: { content: '{' } }] };
  await assert.rejects(runNode('parse_ai_response.js', { nodes: PARSE_NODES, input: truncated }), /token limit/);
  const invalid = { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] };
  await assert.rejects(runNode('parse_ai_response.js', { nodes: PARSE_NODES, input: invalid }), /JSON/);
});

// ---------------------------------------------------------------- error messages
test('maps failures to user-facing Georgian messages', async () => {
  const nodes = { 'Detect Input': { chat_id: 1, message_id: 2 } };
  const unclear = (await runNode('prepare_error.js', { nodes, input: { error: 'UNCLEAR_SOURCE' }, prevNode: 'Parse AI Response' })).json;
  assert.match(unclear.text, /გაუგებარი/);
  const api = (await runNode('prepare_error.js', { nodes, input: { error: { message: '429' } }, prevNode: 'OpenAI Generate' })).json;
  assert.match(api.text, /AI სერვისმა/);
  assert.match(api.text, /429/);
});

test('Sheets failure still delivers the generated content to Telegram', async () => {
  const pack = (await parse(validPack())).json;
  const out = (await runNode('prepare_error.js', {
    nodes: { 'Detect Input': { chat_id: 1, message_id: 2 }, 'Parse AI Response': pack },
    input: { error: { message: 'Sheet not found' } },
    prevNode: 'Save to Google Sheets',
  })).json;
  assert.match(out.text, /INSTAGRAM/);
  assert.ok(out.text.length <= 4000);
});

// ---------------------------------------------------------------- audio file fix
test('renames Telegram .oga voice files to .ogg and leaves other files alone', async () => {
  const voice = await runNode('fix_audio_filename.js', { binary: { data: { fileName: 'file_44.oga', fileExtension: 'oga', mimeType: 'audio/ogg' } } });
  assert.equal(voice.binary.data.fileName, 'file_44.ogg');
  const video = await runNode('fix_audio_filename.js', { binary: { data: { fileName: 'clip.mp4', fileExtension: 'mp4', mimeType: 'video/mp4' } } });
  assert.equal(video.binary.data.fileName, 'clip.mp4');
});
