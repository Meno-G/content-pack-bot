# Lessons learned

Notes from building and testing the bot end-to-end with real Telegram messages, real OpenAI calls and a real Google Sheet. Each entry is **symptom → root cause → fix → result**. Cost figures are estimates from token usage at OpenAI list prices at the time of testing.

---

## 1. Georgian speech-to-text

### 1.1 `language=ka` is rejected by the API
- **Symptom:** every voice message failed with `400 Bad request`.
- **Root cause:** OpenAI's transcription endpoint answered `Language 'ka' is not supported.` Whisper the model knows Georgian, but the API does not accept it as an explicit `language` value.
- **Fix:** removed `language` and passed a Georgian **`prompt`** instead ("Georgian-language recording about marketing…, correct Georgian spelling"). The prompt steers the language without the API check.

### 1.2 `whisper-1` produced gibberish for Georgian
- **Symptom:** a clear 24-second voice note came back as `ჟ჆თდნივნებელი, ვანივი სოვსარილი…`, i.e. Georgian letters but no real words.
- **Fix:** switched the default to **`gpt-4o-transcribe`**.
- **Result:** the same recording was transcribed almost verbatim.

### 1.3 `.oga` files rejected by the newer model
- **Symptom:** after switching models: `Unsupported file format oga`.
- **Root cause:** Telegram stores voice notes as `voice/file_N.oga` (Ogg/Opus). `whisper-1` accepted the extension; `gpt-4o-transcribe` does not, even though the container is identical to `.ogg`.
- **Fix:** a tiny Code node (`Fix Audio Filename`) renames `.oga` → `.ogg` in the binary metadata. No transcoding needed.

### 1.4 The same video transcribed differently on every run
- **Symptom:** one phrase, "ანაზღაურებადი შვებულება" (*paid leave*), came back as a non-word on two runs and as "ანაზღაურების შეწყვეტა" (*termination of pay*) on the third. The last one is a real word with the wrong meaning, so the LLM published a legally wrong statement in every format.
- **Root cause:** a phone video recorded at a distance with room echo. Transcription of borderline audio is non-deterministic.
- **Fix:** a per-client **`vocabulary`** field in the brand profile, sent to the transcription model as a hint and to the LLM as preferred terminology.
- **Result:** the term was transcribed correctly on the first pass. Fixing the input proved more reliable than asking the LLM to guess afterwards.

---

## 2. Hallucination control

### 2.1 Content invented from an unintelligible transcript
- **Symptom:** from the gibberish in 1.2 the LLM still wrote a confident post about "innovative and large-scale solutions".
- **Fix:** added a required enum field **`source_quality: "ok" | "unclear"`** to the JSON schema. On `unclear` the parser throws `UNCLEAR_SOURCE` and the user gets *"the source was unintelligible, so I did not create content"*.

### 2.2 Small embellishments of facts
- **Symptoms:** "free bun before 10:00" became "free bun **with a latte**"; "24 days" became "24 **calendar** days". The second is a material change for a law firm.
- **Fix:** an explicit rule in the system prompt: do not add qualifiers to numbers or facts that are not in the source, with concrete examples.
- **Result:** a follow-up test ("15% off all desserts at the weekend") kept the facts exactly as given.

### 2.3 Garbled fragments padded into content
- **Symptom:** an inaudible last sentence became "…and one more short change" in the post.
- **Fix:** a rule to **skip** unrecoverable fragments entirely instead of referring to them.
- **Result:** the next run said "two changes", matching what was actually audible.

### 2.4 Foreign-script tokens
- **Symptom:** `gpt-5` once wrote the Japanese word `週末` (*weekend*) in the middle of a Georgian LinkedIn post.
- **Fix:** post-validation in `Parse AI Response` strips CJK/Hangul/Thai characters and adds a ⚠️ warning to the Telegram summary so the editor re-reads that sentence.

---

## 3. Model choice: measured, not assumed

Same 37-second video, same brand profile:

| Model | LLM time | Tokens in / out | Est. cost | Quality notes |
|---|---|---|---|---|
| gpt-4.1 | ~11 s | 2,875 / 1,221 | ~$0.02 | Took a mis-transcribed term literally |
| gpt-5 (default effort) | 66 s | 2,876 / 7,255 (5,312 reasoning) | ~$0.08 | Best repair of transcription errors |
| **gpt-5, `reasoning_effort: low`** | **32 s** | 2,986 / 2,574 | **~$0.03** | Most of the quality at less than half the time. **Chosen default** |

**A mistake I caught in my own evaluation:** the first gpt-5 run looked far better than gpt-4.1. But I had just added a prompt rule whose example happened to contain the exact misheard word from that test video. The comparison was not fair, so I removed the test-specific example, generalised the rule and re-ran both models before deciding.

---

## 4. n8n gotchas

| Issue | What happened | Fix |
|---|---|---|
| `$('Node').first()` returned `undefined` | When a node is wired from another node's **error output**, `$('Other').first()` resolves to that branch, which is empty on the error path | Use `$('Parse AI Response').first(0)` to read the success output explicitly |
| Test webhook refused by Telegram: *"An HTTPS URL must be provided"* | In n8n 2.x `WEBHOOK_URL` only sets production webhooks; test webhooks follow `N8N_WEBHOOK_URL` | Set `N8N_WEBHOOK_URL` to the HTTPS tunnel URL |
| Google OAuth redirect mismatch | With only the webhook URL set, the OAuth callback pointed at the public tunnel instead of `localhost` | Set `N8N_EDITOR_BASE_URL=http://localhost:5678/` |
| Workflow silently unpublished | `n8n import:workflow` deactivates a published workflow it overwrites | Re-publish after every CLI import, or make edits in the UI once live |
| Sheet tab not found | A CSV converted to a Google Sheet got a tab name that did not match the configured one | Renamed the tab to the documented `Content` default |
| Formula injection risk in Sheets | Generated text starting with `=`, `+` or `-` could be parsed as a formula | Google Sheets node uses `cellFormat: RAW` |

---

## 5. Design decisions that held up

- **Raw HTTP Request nodes for OpenAI** instead of the built-in node: full control over `response_format` (strict JSON schema), `reasoning_effort` and multipart uploads. They are also unaffected by built-in node version changes between n8n releases.
- **Strict JSON schema plus a validating parser:** the schema guarantees shape; the parser enforces counts, normalises hashtags and decides what the user sees.
- **Layered error handling:** expected failures (bad input, unreachable URL, API errors, Sheets errors) go through error outputs to a single node that sends a friendly Georgian message. Unexpected crashes go to an Error Trigger that alerts the admin. A Sheets failure still delivers the content to Telegram, so the work is never lost.
- **Human in the loop:** every row lands as `დასამტკიცებელი` (*awaiting approval*). The bot writes strong first drafts, not publish-ready copy. The tests above are the reason.
- **Workflow as code:** the Code-node logic lives in `src/nodes/*.js` with unit tests; `scripts/build-workflow.js` assembles the importable JSON with deterministic IDs.

---

## 6. What I would do next

1. **Few-shot brand examples:** 2–3 approved posts per client in the profile, likely the biggest remaining lever for Georgian style quality.
2. **Per-client sheets and chat-ID routing:** prerequisite for letting clients use the bot directly; today all clients share one sheet.
3. **Edit-rate tracking:** log how much editors change each draft, to steer prompt work with data.
4. **Hosting:** move from a laptop plus ngrok to n8n Cloud or a small VPS for 24/7 availability.
5. **Auto-publishing:** post approved rows to Meta and LinkedIn on a schedule.
