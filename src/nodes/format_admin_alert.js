// ⚠️ ჩაწერე ადმინისტრატორის Telegram chat ID (რიცხვი), ვისაც შეცდომის შეტყობინება მოუვა
const ADMIN_CHAT_ID = 'PASTE_ADMIN_CHAT_ID';

const e = $input.first().json;
const exec = e.execution || {};
const err = exec.error || e.trigger?.error || {};

const text = [
  '🚨 შეცდომა workflow-ში',
  `Workflow: ${e.workflow?.name || '—'}`,
  `ნოდი: ${exec.lastNodeExecuted || '—'}`,
  `შეცდომა: ${err.message || 'უცნობი'}`,
  exec.mode ? `რეჟიმი: ${exec.mode}` : null,
  exec.url ? `🔗 ${exec.url}` : null,
].filter(Boolean).join('\n');

return [{ json: { chat_id: ADMIN_CHAT_ID, text: text.slice(0, 4000) } }];
