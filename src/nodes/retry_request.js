// პასუხში სხვა დამწერლობის სიტყვები გაერია — OpenAI-ს ერთხელ ვეკითხებით თავიდან.
// თუ Settings-ში fallback_model სხვა მოდელია, მეორე ცდა იმ მოდელით კეთდება.
const s = $('Settings').first().json;
const req = JSON.parse(JSON.stringify($('Build AI Request').first().json));
const fallback = String(s.fallback_model || '').trim();

if (fallback && fallback !== req.body.model) {
  req.body.model = fallback;
  if (/^(o\d|gpt-5)/i.test(fallback)) {
    delete req.body.temperature;
    if (s.reasoning_effort) req.body.reasoning_effort = s.reasoning_effort;
  } else {
    delete req.body.reasoning_effort;
    req.body.temperature = 0.8;
  }
}
return [{ json: req }];
