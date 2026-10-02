# 📦 Content Pack Bot — n8n workflow

ერთი წყარო (ვიდეო, აუდიო, ლინკი ან ტექსტი) Telegram-ში შედის, ხოლო Google Sheets-ში მზა კონტენტ-პაკეტი ჩნდება:
Instagram + 5 ჰეშთეგი, Facebook, LinkedIn, 3 Reels/TikTok იდეა და 5 სათაური, სტატუსით „დასამტკიცებელი“.

ფაილები:
- [content-pack-workflow.json](../workflow/content-pack-workflow.json): n8n-ში იმპორტისთვის
- `docs/setup-ka.md`: ეს ინსტრუქცია

---

## 1. Workflow-ს სტრუქტურა

```
Telegram Trigger → Settings → Brand Profiles → Detect Input → Input OK?
                                                               │ true ──► Send Ack (⏳ „მივიღე…“)
                                                               │ true ──► Route by Type
                                                               │            ├─ media ─► Get Telegram File ─► Fix Audio Filename ─► Whisper Transcribe ─► Source: Transcript ─┐
                                                               │            ├─ url ───► Fetch URL ─► Extract Article Text ─────────────────────────────┤
                                                               │            └─ text ──► Source: Text ──────────────────────────────────────────────────┤
                                                               │                                                                                       ▼
                                                               │                       Source OK? ─► Build AI Request ─► OpenAI Generate ─► Parse AI Response
                                                               │                                                                                       ▼
                                                               │                                                   Save to Google Sheets ─► Send Summary ✅
                                                               │ false
                                                               ▼
               (ყველა error გამოსავალი) ─────────────► Prepare Error Message ─► Send Error Message ⚠️

Error Trigger ─► Format Admin Alert ─► Notify Admin 🚨   (გლობალური, მოულოდნელი შეცდომები)
```

### ნოდები და პარამეტრები

| # | ნოდი | ტიპი | რას აკეთებს / მთავარი პარამეტრები |
|---|------|------|-------------------------------------|
| 1 | **Telegram Trigger** | Telegram Trigger v1.2 | Updates: `message`. Credential: Telegram API |
| 2 | **Settings** | Edit Fields (Set) v3.4 | ყველა ტექნიკური პარამეტრი ერთ ადგილზე (იხ. ქვემოთ) |
| 3 | **Brand Profiles** | Code | კლიენტების brand voice. Telegram-ში `#გასაღები` (მაგ. `#cafe`) ირჩევს პროფილს |
| 4 | **Detect Input** | Code | ადგენს ტიპს: `media` / `url` / `text`. ამოწმებს წვდომას (`allowed_chat_ids`), ზომას (≤20 MB), `/start` და `/help` ბრძანებებს, YouTube/Instagram/TikTok/Facebook ლინკებს. შეცდომისას ავსებს `error_message`-ს |
| 5 | **Input OK?** | IF v2.2 | `{{ $json.ok }}` is true. False → Prepare Error Message |
| 6 | **Send Ack** | Telegram → Send Message | „⏳ მივიღე… ვამზადებ“. `reply_to_message_id`, On Error: Continue |
| 7 | **Route by Type** | Switch v3.2 (Rules) | `$json.type` = `media` → 0, `url` → 1, `text` → 2 |
| 8 | **Get Telegram File** | Telegram → File → Get | `fileId = {{ $json.file_id }}`, Download: ✅ (binary ველი `data`). Retry 2×, On Error: error output |
| 8a | **Fix Audio Filename** | Code | Telegram-ის ხმოვანი `.oga` გაფართოებით მოდის, `gpt-4o-transcribe` კი ამ გაფართოებას არ იღებს. ნოდი ფაილს `.ogg`-ად გადაარქმევს (ფორმატი იგივეა) |
| 9 | **Whisper Transcribe** | HTTP Request v4.2 | `POST https://api.openai.com/v1/audio/transcriptions`, Auth: Predefined → OpenAI. Body: multipart-form-data, `file` = binary `data`, `model` = Settings-იდან (`gpt-4o-transcribe`), `prompt` = ქართული მინიშნება (`language=ka` API-ს მხარდაჭერილი არ აქვს). Timeout 300 წმ, Retry 2×, error output |
| 10 | **Source: Transcript** | Set | `source_text = {{ $json.text }}` + source_type/source_ref/extra_context Detect Input-იდან |
| 11 | **Fetch URL** | HTTP Request v4.2 | GET `{{ $json.url }}`, Response format: Text → `html`, ბრაუზერის User-Agent, Timeout 30 წმ, Retry 2×, error output |
| 12 | **Extract Article Text** | Code | HTML-დან სტატიის ტექსტი: og:title, description და `<article>`/`<main>`/`<body>`. script/nav/footer და სხვა ზედმეტი ელემენტები იშლება. თუ ტექსტი 200 სიმბოლოზე ნაკლებია, ავსებს `error_message`-ს |
| 13 | **Source: Text** | Set | `source_text = {{ $json.text }}` |
| 14 | **Source OK?** | IF | `!error_message && source_text.length >= 20` |
| 15 | **Build AI Request** | Code | აწყობს system/user prompt-ს ბრენდის პროფილით და **strict JSON Schema**-ს (`response_format: json_schema`) |
| 16 | **OpenAI Generate** | HTTP Request v4.2 | `POST https://api.openai.com/v1/chat/completions`, JSON body `{{ JSON.stringify($json.body) }}`. Timeout 180 წმ, Retry 3× (5 წმ ინტერვალით), error output |
| 17 | **Parse AI Response** | Code | JSON.parse და ვალიდაცია: აუცილებელი ველები, ჰეშთეგები (# და ჰარის გარეშე, უნიკალური, 5) და ქართული/ლათინურის გარდა ყველა დამწერლობის ამოცნობა. ამზადებს Sheets-ის სვეტებს და Telegram-ის შეჯამებას. თუ ფორმატი არასწორია, დააბრუნებს error-ს |
| 17a | **Retry Needed?** | IF | თუ პირველ ცდაზე სხვა დამწერლობა გაერია (`foreign_found`), OpenAI-ს ერთხელ თავიდან ჰკითხავს. მეორე ცდის შემდეგ ტექსტი ავტომატურად სწორდება: კირილიცა ქართულად გადაიწერება, მსგავსი ასოები ჩანაცვლდება და რედაქტორი გაფრთხილებას მიიღებს |
| 17b | **Retry Request** | Code | იგივე მოთხოვნას ხელახლა აგზავნის. თუ `fallback_model` განსხვავებულია, იმ მოდელით |
| 18 | **Save to Google Sheets** | Google Sheets v4.5 → Append | Document ID / Sheet ჩანართი Settings-იდან, Mapping: *Map each column manually*, Cell format: RAW. Retry 2×, error output |
| 19 | **Send Summary** | Telegram → Send Message | შეჯამება + 5 სათაური + Sheets-ის ლინკი |
| 20 | **Prepare Error Message** | Code | `$prevNode`-ის მიხედვით ირჩევს გასაგებ ქართულ შეტყობინებას. Sheets-ის შეცდომისას კონტენტს Telegram-ში პირდაპირ აგზავნის, ასე რომ ის არ იკარგება |
| 21 | **Send Error Message** | Telegram → Send Message | შეცდომის შეტყობინება მომხმარებელს |
| 22 | **Error Trigger** | Error Trigger | გლობალური შეცდომები (მხოლოდ production-ში) |
| 23 | **Format Admin Alert** | Code | `ADMIN_CHAT_ID`, workflow, ნოდი, შეცდომის ტექსტი და execution-ის ლინკი |
| 24 | **Notify Admin** | Telegram → Send Message | შეტყობინება ადმინს |

### Settings ნოდის ველები

| ველი | ნაგულისხმევი | აღწერა |
|------|-------------|--------|
| `sheet_id` | `PASTE_GOOGLE_SHEET_ID` | ცხრილის ID URL-იდან: `docs.google.com/spreadsheets/d/`**`ეს_ნაწილი`**`/edit` |
| `sheet_tab` | `Content` | ჩანართის (ფურცლის) სახელი |
| `openai_model` | `gpt-4.1` | ქართულისთვის ყველაზე საიმედო მოდელი ჩვენს ტესტებში. 9 გაშვებიდან არცერთში არ გაერია სხვა დამწერლობა, საშუალოდ ≈14 წმ, ≈2 ცენტი. `gpt-5`-მა 8-დან 6 გაშვებაში ქართულ ტექსტში რუსული, ბენგალური, კორეული და სხვა ასოები გაურია, საშუალოდ ≈57 წმ-ში. დეტალები: [lessons-learned.md](lessons-learned.md) |
| `fallback_model` | `gpt-4.1` | თუ პასუხში სხვა დამწერლობა გაერია, მეორე ცდა ამ მოდელით კეთდება. შეიძლება ემთხვეოდეს მთავარ მოდელს |
| `reasoning_effort` | `medium` | მოქმედებს მხოლოდ მაშინ, როცა მოდელი gpt-5/o-სერიისაა: `minimal`, `low`, `medium` ან `high` |
| `transcription_model` | `gpt-4o-transcribe` | ტესტებში `whisper-1`-მა ქართული ვერ ამოიცნო და უაზრო ტექსტი დააბრუნა, ამიტომ ნაგულისხმევად `gpt-4o-transcribe` დგას |
| `transcription_prompt` | ქართული მინიშნება | Whisper-ს ენასა და მართლწერას უკარნახებს. OpenAI-ის API-ს `language=ka` პარამეტრი მხარდაჭერილი არ აქვს, ამიტომ ენას ამ ტექსტით ვაძლევთ. ინგლისურენოვანი ვიდეოსთვის prompt ინგლისურად დაწერე. აქ შეგიძლია ბრენდებისა და ტერმინების სახელებიც ჩაწერო, რომ სწორად ამოიცნოს |
| `allowed_chat_ids` | *(ცარიელი)* | მძიმით გამოყოფილი chat ID-ები. ცარიელი ნიშნავს, რომ ბოტით ყველა ისარგებლებს. **რეკომენდებულია, შეავსო** |
| `max_file_mb` | `20` | Telegram Bot API-ის ლიმიტი 20 MB-ია |
| `max_source_chars` | `12000` | AI-სთვის გადაცემული წყაროს მაქსიმალური სიგრძე |

### Brand voice: მრავალი კლიენტი

**Brand Profiles** ნოდში თითოეული კლიენტი ცალკე ბლოკია:

```js
cafe: {
  client_name: 'ყავახანა (მაგალითი)',
  brand_voice: 'თბილი, მყუდრო, ოდნავ პოეტური...',
  target_audience: '20–35 წლის სტუდენტები...',
  address_form: 'შენობით (შენ)',      // ან 'თქვენობით (თქვენ)'
  cta: 'შემოგვიარე — ყავა უკვე გელოდება',
  rules: 'ფასები მხოლოდ წყაროდან.',
  vocabulary: 'ესპრესო, ფლეტ უაითი, ქოლდ ბრიუ, მატჩა...',   // ტერმინები მძიმით
  examples: `...`,   // 2–3 კლიენტის მოწონებული პოსტი: ტონის ყველაზე ძლიერი მაგალითი
},
```

**`vocabulary` (ლექსიკონი)** ორ რამეს აკეთებს:
1. **ტრანსკრიფციას** ეხმარება, რადგან ტერმინები `gpt-4o-transcribe`-ს მინიშნებად მიეწოდება. ეს ყველაზე ეფექტური ზომაა. ტესტში „ანაზღაურებადი შვებულება“ ლექსიკონის გარეშე სხვადასხვა გაშვებაში ხან „შეღავულებად“ იქცა, ხან „შეწყვეტად“.
2. **AI-ს** ეხმარება დამახინჯებული სიტყვის აღდგენაში და ტერმინების სწორად დაწერაში.

ყველა კლიენტს ჩაუწერე: ბრენდისა და პროდუქტების სახელები, დარგის ტერმინები და ის სიტყვები, რომლებსაც ხშირად ამბობენ ვიდეოებში.

Telegram-ში: `#cafe ახალი სეზონური მენიუ...` ან ვიდეოს caption-ში `#law`. ტეგის გარეშე `default` პროფილი გამოიყენება.

> 💡 თუ კლიენტი ბევრია, პროფილები შეგიძლია Google Sheets-ის ცალკე ჩანართში („Brands“) შეინახო და Brand Profiles-ის ნაცვლად Google Sheets → Get Rows ნოდით წაიკითხო.

### Google Sheets: სვეტები (სათაურების ხაზი)

შექმენი ცხრილი, ჩანართს დაარქვი `Content` და **A1** უჯრაში ჩასვი ეს ხაზი (სვეტები Tab-ით არის გამოყოფილი და თავისით გადანაწილდება):

```
თარიღი	კლიენტი	სტატუსი	წყაროს ტიპი	წყარო	შეჯამება	Instagram	Facebook	LinkedIn	Reels/TikTok იდეები	სათაურები	ავტორი (Telegram)	წყაროს ტექსტი
```

რჩევა: „სტატუსი“ სვეტზე დაამატე Data validation dropdown-ით (`დასამტკიცებელი`, `დამტკიცებული`, `შესასწორებელი`, `გამოქვეყნებული`) და ტექსტის სვეტებზე ჩართე Wrap.

---

## 2. n8n-ში იმპორტი

1. გახსენი [content-pack-workflow.json](../workflow/content-pack-workflow.json), მონიშნე მთელი შიგთავსი (Ctrl+A) და დააკოპირე (Ctrl+C).
2. n8n-ში შექმენი ახალი workflow, დააწკაპე ცარიელ კანვასზე და დააჭირე **Ctrl+V**.
   (ან: ზედა მარჯვენა `⋯` → **Import from File…** და აირჩიე JSON ფაილი.)
3. Save.

---

## 3. AI-ს პრომპტები

პრომპტები **Build AI Request** ნოდშია. მათი სრული, მუდმივად განახლებული ტექსტი იხილე აქ: [src/nodes/build_ai_request.js](../src/nodes/build_ai_request.js). `${...}` ველები ავტომატურად ივსება ბრენდის პროფილიდან და წყაროდან. პასუხის ფორმატს OpenAI-ის **Structured Outputs** (`json_schema`, `strict: true`) ამოწმებს, Parse AI Response კი რაოდენობებსა და დამწერლობას დამატებით ამოწმებს.

**System prompt-ის სტრუქტურა:**
1. **ენა:** მხოლოდ ქართული ანბანი (ლათინური მხოლოდ ბრენდებისა და პლატფორმების სახელებისთვის), კალკების აკრძალვა, ტრანსკრიფციის შეცდომების აღდგენა ბრენდის ტერმინოლოგიით, გაუგებარი ფრაგმენტების გამოტოვება.
2. **როგორ ჟღერდეს ბუნებრივად:** მოკლე წინადადებები, ზმნა არსებითი სახელის ნაცვლად, მაქსიმუმ ერთი ხატოვანი გამოთქმა, ტესტებიდან აღებული აკრძალული ფრაზები და თვითშემოწმება „ქართველი რედაქტორის თვალით“.
3. **ფაქტები:** არაფერი მოიგონოს, ციფრებს დაზუსტება არ დაუმატოს („24 დღე“ ≠ „24 კალენდარული დღე“), ტერმინოლოგიიდან პროდუქტები არ ახსენოს, `source_quality: "unclear"`.
4. **ბრენდის პროფილი:** ტონი, აუდიტორია, მიმართვის ფორმა (შენ/თქვენ), CTA, წესები, ტერმინოლოგია და სტილის მაგალითები. პროფილს უპირატესობა აქვს ფორმატის წესებთან, მაგალითად, თუ ბრენდი ემოჯის კრძალავს, ემოჯი არ გამოიყენება.
5. **ფორმატები:** Instagram (+5 რეალური ჰეშთეგი), Facebook, LinkedIn (კონკრეტული ფაქტები, კორპორატიული ფრაზების გარეშე), 3 Reels იდეა (ეკრანის ტექსტი და ხმა მხოლოდ ფაქტებით), 5 სათაური (ზუსტი აზრით).
6. **პასუხი:** მხოლოდ JSON, სქემის მიხედვით.

**User prompt:** წყაროს ტიპი, წყარო, მომხმარებლის მითითება (caption ან ლინკის გვერდით დაწერილი ტექსტი) და წყაროს ტექსტი `<<< >>>` გამყოფებს შორის.

---

## 4. Credentials: რა გჭირდება და როგორ მიიღო

### 🤖 Telegram Bot

1. Telegram-ში გახსენი **@BotFather** და გაუგზავნე `/newbot`.
2. მიეცი სახელი (მაგ. `Agency Content Bot`) და username, რომელიც `bot`-ით მთავრდება.
3. BotFather მოგცემს **token**-ს (`123456789:AA...`).
4. n8n → **Credentials → Add credential → Telegram API**, Access Token-ში ჩასვი token.
5. მიაბი ეს credential ნოდებს: Telegram Trigger, Send Ack, Get Telegram File, Send Summary, Send Error Message, Notify Admin.

⚠️ Telegram Trigger-ს **HTTPS**-ზე ხელმისაწვდომი n8n სჭირდება. n8n Cloud-ზე ეს უკვე მოგვარებულია. Self-hosted-ზე `WEBHOOK_URL` გარემოს ცვლადში საჯარო https მისამართი უნდა მიუთითო (დომენი + SSL, Cloudflare Tunnel ან ngrok).

**შენი chat ID:** შეავსე `allowed_chat_ids`-ში ნებისმიერი ციფრი (მაგ. `0`), გაუგზავნე ბოტს რამე და ის შენს Chat ID-ს მოგწერს. ან გამოიყენე @userinfobot.

### 🧠 OpenAI (Whisper + GPT)

1. გადადი [platform.openai.com](https://platform.openai.com) → **API keys** → **Create new secret key**.
2. **Billing**-ში დაამატე ბალანსი. API ChatGPT Plus-ის გამოწერისგან ცალკე იხდება.
3. n8n → **Credentials → Add credential → OpenAI** (OpenAi API), API Key-ში ჩასვი გასაღები.
4. მიაბი: **Whisper Transcribe** და **OpenAI Generate** (ორივე HTTP Request-ია, Authentication: *Predefined Credential Type → OpenAI*).

ხარჯი: Whisper დაახლოებით $0.006 წუთში. ერთი კონტენტ-პაკეტი GPT-4.1-ით ჩვეულებრივ რამდენიმე ცენტი ჯდება. ზუსტი ფასები: platform.openai.com/pricing.

### 📊 Google Sheets

**n8n Cloud:** Credentials → **Google Sheets OAuth2 API** → **Sign in with Google**. სულ ეს არის.

**Self-hosted:**
1. [console.cloud.google.com](https://console.cloud.google.com) → შექმენი პროექტი.
2. **APIs & Services → Library** → ჩართე **Google Sheets API** და **Google Drive API**.
3. **OAuth consent screen** → External → შეავსე სახელი და email → Test users-ში დაამატე შენი Gmail.
4. **Credentials → Create credentials → OAuth client ID** → Web application.
   **Authorized redirect URI**-ში ჩასვი n8n-ის credential ფანჯრიდან დაკოპირებული `OAuth Redirect URL` (`https://შენი-n8n/rest/oauth2-credential/callback`).
5. Client ID და Client Secret ჩასვი n8n-ის **Google Sheets OAuth2 API** credential-ში და დააჭირე **Sign in with Google**.
6. 💡 თუ consent screen „Testing“ სტატუსშია, ტოკენი 7 დღეში ამოიწურება. მუდმივი მუშაობისთვის დააჭირე **Publish app**.

ალტერნატივა: **Service Account**. Google Cloud-ში შექმენი Service Account, ჩამოტვირთე JSON key და ცხრილი **გაუზიარე** service account-ის email-ს (Editor უფლებით).

მიაბი credential ნოდს **Save to Google Sheets**.

### ბოლო ნაბიჯები

- **Settings** → `sheet_id` (და სასურველია `allowed_chat_ids`).
- **Format Admin Alert** → `ADMIN_CHAT_ID`.
- Save → ზედა მარჯვენა `⋯` → **Settings** → **Error Workflow** → აირჩიე **ეს workflow** → Save.

---

## 5. ეტაპობრივი ტესტირება

> ⚠️ Telegram ბოტს ერთდროულად მხოლოდ ერთი webhook აქვს. ტესტირებისას workflow **გამორთული** (Inactive) უნდა იყოს. ტესტის დასრულების შემდეგ ისევ ჩართე, რომ production webhook თავიდან დარეგისტრირდეს.

**ნაბიჯი 1: Telegram კავშირი**
1. დააჭირე **Test workflow** (ან Telegram Trigger-ზე **Listen for test event**).
2. ბოტს გაუგზავნე `/start`.
3. ✅ მოსალოდნელია: მოვა დახმარების ტექსტი. Detect Input-ის output-ში ჩანს `type: "help"`.
4. 💡 Telegram Trigger-ზე დააჭირე **Pin data** (📌), რომ შემდეგ ეს შეტყობინება თავიდან გაგზავნის გარეშე გამოიყენო.

**ნაბიჯი 2: ტექსტი, ანუ მთელი ჯაჭვი ყველაზე იაფად**
1. გაგზავნე: `#cafe ოქტომბრიდან მენიუში გვაქვს გოგრის ლატე და დარიჩინის ფუნთუშა. ლატე 9 ლარი ღირს.`
2. შეამოწმე თანმიმდევრობით:
   - **Brand Profiles** → `brand_key: "cafe"`
   - **Detect Input** → `type: "text"`, ტექსტი `#cafe`-ის გარეშე
   - **Build AI Request** → `body.messages[0].content`-ში ბრენდის ტონი სწორად ჩაჯდა
   - **OpenAI Generate** → `choices[0].message.content` JSON-ია
   - **Parse AI Response** → 5 ჰეშთეგი, 3 იდეა, 5 სათაური
   - **Google Sheets** → ახალი ხაზი სტატუსით „დასამტკიცებელი“
   - **Telegram** → შეჯამება ლინკით
3. ✅ ფასი (9 ლარი) კონტენტში ზუსტად ისე უნდა იყოს, როგორც წყაროშია. AI-მ ახალი ციფრები არ უნდა მოიგონოს.
4. 💡 **OpenAI Generate**-ზე Pin data, რომ Sheets/Telegram-ის ტესტისას ტოკენები არ დახარჯო.

**ნაბიჯი 3: ლინკი**
1. გაგზავნე ქართული ახალი ამბების ან ბლოგის სტატიის ლინკი.
2. **Extract Article Text** → `source_text` სტატიის ტექსტს უნდა შეიცავდეს და არა მენიუს ან ფუტერს.
3. სცადე ლინკი + მითითება: `https://... აქცენტი გააკეთე ციფრებზე` → `extra_context`-ში ჩანს მითითება.

**ნაბიჯი 4: ხმოვანი შეტყობინება**
1. ჩაწერე 20–30 წამიანი ხმოვანი ქართულად.
2. **Get Telegram File** → output-ში ჩანს binary `data` (.oga).
3. **Whisper Transcribe** → `text` ტრანსკრიპტს შეიცავს. თუ ტრანსკრიპტი გაუგებარია, AI `source_quality: "unclear"`-ს დააბრუნებს და ბოტი მოგწერს, რომ ჩანაწერი გაუგებარია. ასეთ შემთხვევაში კონტენტი არ იქმნება.

**ნაბიჯი 5: ვიდეო**
1. გაგზავნე მოკლე mp4 (< 20 MB), სურვილისამებრ caption-ით `#law`.
2. შეამოწმე, რომ ტრანსკრიფცია და `law` პროფილის ტონი (თქვენობით, ემოჯის გარეშე) სწორად მუშაობს.

**ნაბიჯი 6: შეცდომების შემოწმება** (თითოეულზე უნდა მოვიდეს გასაგები ქართული შეტყობინება)

| ტესტი | მოსალოდნელი შედეგი |
|-------|-------------------|
| სტიკერი ან ფოტო caption-ის გარეშე | 🤔 „ამ ტიპის შეტყობინებას ვერ ვამუშავებ“ |
| `გამარჯობა` (მოკლე ტექსტი) | ✂️ „ტექსტი ძალიან მოკლეა“ |
| ვიდეო > 20 MB | 📦 „ფაილი ძალიან დიდია“ |
| `https://youtu.be/xxxx` | 🔗 „ამ პლატფორმის ლინკიდან ვერ ვიღებ“ |
| `https://this-domain-does-not-exist-123.ge` | 🌐 „ლინკი ვერ გაიხსნა“ |
| Settings-ში `openai_model` = `gpt-wrong` | 🤖 „AI სერვისმა პასუხი ვერ დააბრუნა“ + დეტალი |
| Settings-ში `sheet_tab` = `WrongTab` | 📊 „Sheets-ში ჩაწერა ვერ მოხერხდა“, თან კონტენტი Telegram-ში მოდის |
| `allowed_chat_ids` = `0` | ⛔ „უფლება არ გაქვს“ + შენი Chat ID |

ტესტის შემდეგ პარამეტრები დააბრუნე სწორ მნიშვნელობებზე.

**ნაბიჯი 7: გლობალური Error Trigger** (მუშაობს მხოლოდ აქტიურ workflow-ზე)
1. **Build AI Request**-ის კოდის პირველ ხაზად დროებით ჩაწერე `throw new Error('ტესტი');`.
2. ჩართე workflow (**Active**) და ბოტს გაუგზავნე ტექსტი.
3. ✅ ადმინს მოუვა 🚨 შეტყობინება ნოდის სახელით და execution-ის ლინკით.
4. წაშალე ტესტის ხაზი და Save.

**ნაბიჯი 8: Production**
- Unpin ყველა pinned data. Pinned data production-ზე გავლენას არ ახდენს, მაგრამ ტესტებს აბნევს.
- ჩართე **Active**. ✅ რეალური სამუშაო რეჟიმი.

---

## ბოტის გაშვება (self-hosted, Windows)

ბოტის მუშაობისთვის კომპიუტერზე ერთდროულად ორი რამ უნდა იყოს ჩართული: **n8n** და **ngrok**-ის ტუნელი, რადგან Telegram-ს HTTPS მისამართი სჭირდება.

- ორჯერ დააწკაპე [start-bot.cmd](../start-bot.cmd). ის ჩართავს ngrok-ს მუდმივ მისამართზე (შენი სტატიკური ngrok დომენი) და n8n-ს სწორი პარამეტრებით.
- ფანჯრები ღია დატოვე. თუ კომპიუტერი გამოირთვება ან დაიძინებს, ბოტი გაჩერდება.
- 24/7 მუშაობისთვის n8n სერვერზე გადაიტანე: n8n Cloud, VPS Docker-ით და ა.შ. იქ ngrok აღარ დაგჭირდება.
- n8n 2.x-ში სატესტო webhook-ის მისამართს `N8N_WEBHOOK_URL` განსაზღვრავს (`WEBHOOK_URL` მოძველებულია). `N8N_EDITOR_BASE_URL=http://localhost:5678/` კი საჭიროა, რომ Google-ში შესვლა localhost-ზე დაბრუნდეს.

## შეზღუდვები და რჩევები

- **20 MB** არის Telegram Bot API-ის ლიმიტი ფაილის ჩამოტვირთვაზე. დიდი ვიდეოსთვის გაგზავნე მხოლოდ აუდიო (mp3/m4a) ან შეკუმშული ვერსია. ამ ლიმიტის მოსახსნელად საკუთარი Telegram Bot API სერვერი (`telegram-bot-api`, `--local` რეჟიმით) დაგჭირდება.
- **YouTube/Instagram/TikTok** ლინკები ტექსტს არ შეიცავს, ამიტომ ვიდეო ფაილად უნდა გაიგზავნოს.
- **JavaScript-ზე აწყობილი საიტები** და paywall-იანი სტატიები შეიძლება ვერ წაიკითხოს. ბოტი ამ შემთხვევაში სთხოვს მომხმარებელს, ტექსტი პირდაპირ ჩააკოპიროს.
- **ქართულის ხარისხი:** ყველაზე დიდ ეფექტს ბრენდის პროფილის `examples` ველი იძლევა: ჩასვი 2–3 პოსტი, რომელიც კლიენტს მოსწონს. თუ ტექსტში სხვა დამწერლობა ერევა, Settings-ში მოდელი შეამოწმე. ქართულზე ყველაზე საიმედო ტესტებში `gpt-4.1` აღმოჩნდა.
