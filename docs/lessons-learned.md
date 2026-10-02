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

### 2.4 Foreign-script tokens inside Georgian text
- **Symptoms:** `gpt-5` repeatedly put letters from other scripts into Georgian words. Examples: `週末` (Japanese "weekend"), `দিনে` (Bengali "day"), `и действ…` (Russian), `кафეში` (Russian letters inside "კაფეში"), and `ലეპტოპს` (Malayalam ല, which looks like Georgian ლ).
- **First fix (insufficient):** strip CJK characters. It missed most cases, and stripping letters *inside* a word broke the word (`ლეპტოპს` → `ეპტოპს`).
- **Final fix, three layers:**
  1. A prompt rule: Georgian script only; Latin only for brand/platform names and hashtags.
  2. Detection of *any* letter that is neither Georgian nor Latin (`p{Script}` regex). On the first hit the workflow **regenerates once** (`Retry Needed?` → `Retry Request`), optionally with a `fallback_model`.
  3. If the second answer is still dirty, Cyrillic runs glued to Georgian letters are transliterated (`кафეში` → `კაფეში`), known look-alikes are replaced (`ല` → `ლ`), stand-alone foreign words are removed, and the editor is warned.
- **Root-cause fix:** switching the default model (see section 3) eliminated the problem in practice.

### 2.5 Vocabulary leaked into the content as facts
- **Symptom:** the post for a café opening mentioned croissants, cappuccino and filter coffee. None of them were in the source.
- **Root cause:** the per-client `vocabulary` list (meant for spelling and transcription) was read by the model as "things this café sells".
- **Fix:** an explicit rule that terminology is for spelling only and must not introduce products or services. A matching rule for Reels: shot descriptions may be creative, but on-screen text and voice-over may only state source facts (one run had invented "free Wi-Fi").

### 2.6 "Translated-sounding" Georgian
- **Symptom:** grammatically valid but unnatural copy, such as "ამ სურნელში არის პატარა დღესასწაული" (*in this aroma there is a small celebration*) and corporate filler on LinkedIn.
- **Root causes:** an over-poetic example brand profile I had written, and no concrete style guidance.
- **Fix:** style rules with real bad examples from earlier runs (forbidden patterns), verbs over noun chains, at most one figurative phrase per post, and an explicit "proofread like a Georgian editor" step. Brand profiles gained an `examples` field for real approved posts, the strongest lever for tone.
- **Result:** the same café brief produced plain, natural copy ("ახალ ფილიალში დაგხვდება ლეპტოპით სამუშაო ზონა და ღია ტერასა — მოდი, იმუშავე ან უბრალოდ განიტვირთე ჩვენთან.").

---

## 3. Model choice: measured, then reversed

**Round 1, one video, one brand profile.** I measured speed and repair quality:

| Model | LLM time | Tokens in / out | Est. cost | Observation |
|---|---|---|---|---|
| gpt-4.1 | ~11 s | 2,875 / 1,221 | ~$0.02 | Took a mis-transcribed term literally |
| gpt-5 (default effort) | 66 s | 2,876 / 7,255 (5,312 reasoning) | ~$0.08 | Repaired transcription errors best |
| gpt-5, `reasoning_effort: low` | 32 s | 2,986 / 2,574 | ~$0.03 | Most of the quality at half the time |

On that basis I made **gpt-5 (low)** the default. I also caught a flaw in my own comparison: a prompt example I had just added contained the exact misheard word from that test video. I generalised the rule and re-ran before deciding.

**Round 2, real usage.** Over the next demo runs gpt-5 began mixing other scripts into Georgian (section 2.4), at low and at medium effort. I then audited **every generation in the execution history** with the same script detector:

| Model | Generations | With foreign-script letters | Avg. LLM time |
|---|---|---|---|
| gpt-4.1 | 9 | **0** | 14 s |
| gpt-5 (low / medium / default) | 8 | **6** (Russian, Bengali, Tamil, Malayalam, Korean, Japanese) | 57 s |

The audit also showed that one gpt-5 run I had judged "clean" by reading it contained a Korean word I had missed. Eyeballing output is not a measurement.

**Decision:** gpt-4.1 is the default. Its main weakness, taking transcription errors literally, is now handled upstream by the per-client vocabulary (1.4). gpt-5 stays available as `fallback_model` or primary via one setting. **Lesson:** a model that is "smarter" on benchmarks can be worse for a specific language. Measure on your own data, over many runs, with an automated check.

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

1. **Fill the `examples` field** with 2–3 approved posts per client. The field and prompt wiring exist; real examples are likely the biggest remaining lever for Georgian style.
2. **Per-client sheets and chat-ID routing:** prerequisite for letting clients use the bot directly; today all clients share one sheet.
3. **Edit-rate tracking:** log how much editors change each draft, to steer prompt work with data.
4. **Hosting:** move from a laptop plus ngrok to n8n Cloud or a small VPS for 24/7 availability.
5. **Auto-publishing:** post approved rows to Meta and LinkedIn on a schedule.
