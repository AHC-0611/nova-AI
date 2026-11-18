# Nova AI

Your own ChatGPT-style AI site that anyone can use with no sign-up. It runs on a free vercel.app address and pools free AI providers (Groq, plus optional Gemini, OpenRouter and Mistral).

## Features
- **Chat history**: saved chats in a sidebar, with search, rename and delete
- **Answer level by grade**: pick Grades K–2 up to College or Expert, and Nova explains things at that level
- **Credit counter**: shows how many free messages are left today
- **Smart / Fast models**: Smart (GPT-OSS 120B) for best answers, Fast (GPT-OSS 20B) for quick ones
- **Images**: attach, paste or drag in up to 4 images and ask about them (homework photos, screenshots, memes)
- **Files**: PDF, Word (.docx), text, CSV and code files. Nova reads them and answers about them
- **Links**: paste up to 3 links and Nova opens the pages and answers from them (shown under Sources)
- **Web search**: uses Groq's built-in search when your free plan allows it
- **Voice**: tap 🎤 to talk instead of typing; 🔊 reads answers aloud (pick the voice in Settings)
- **Edit & retry**: edit any message you sent, or hit Try again for a new answer
- **Custom instructions**: tell Nova about yourself or how to reply (Settings)
- Tables, code blocks with copy buttons, dark/light theme, download a chat as a file, works on phones
- Shortcut: Ctrl+Shift+O starts a new chat

Chats are saved in each visitor's own browser, not on the server. Free AI providers (especially Gemini and Mistral) may use what people type to improve their models, so the site reminds people not to share private info.

## Setup (about 15 minutes)

Nova is set up as a **public site**: anyone with the link can chat, no password or sign-up. Each visitor gets **25 free credits a day** (1 message = 1 credit), shown in a counter at the top. Credits refill at midnight New York time, and a message that fails doesn't use a credit. 25 credits is sized so about 25 people a day fit inside the free AI limits.

### 1. Get free API keys (more keys = more people it can handle)
| Provider | Where | Needed? |
|---|---|---|
| Groq | https://console.groq.com → API Keys | **Yes**, the main AI |
| Google Gemini | https://aistudio.google.com/apikey | Recommended, adds capacity + Google Search |
| OpenRouter | https://openrouter.ai/keys | Optional, adds capacity (about 200 free messages a day) |
| Mistral | https://console.mistral.ai | Optional, needs phone verification |

All are free with no credit card. Keep the keys private. Don't paste them into the code or share them.

### 2. Put the project on GitHub
Upload `index.html`, `README.md` and the `api` folder (with `chat.js`) to a new GitHub repo.

### 3. Deploy on Vercel
1. On vercel.com click **Add New → Project** and import the repo. Leave the build settings alone.
2. Under **Environment Variables**, add each key you have: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`. Do **not** add `SITE_PASSWORD` (that would lock the site).
3. Click **Deploy**.

### 4. Turn on the message counter (free, makes the limit work properly)
1. In your Vercel project open the **Storage** tab → **Create Database** → choose **Upstash for Redis** (free plan) → connect it to this project.
2. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. Go to **Deployments → ⋯ → Redeploy**.

Without this step the limit still works a little, but it resets often, so don't skip it for a public site.

If you change an environment variable later, redeploy so the change takes effect.

## Optional settings (environment variables)

| Name | What it does | Default |
|---|---|---|
| `GROQ_MODEL` | model for **Smart** | `openai/gpt-oss-120b` |
| `GROQ_FAST_MODEL` | model for **Fast** | `openai/gpt-oss-20b` |
| `GROQ_VISION_MODEL` | model used when you attach images | `meta-llama/llama-4-scout-17b-16e-instruct` |
| `MAX_CONTEXT_CHARS` | how much chat history and file text is sent each time (smaller = more people served) | `16000` |
| `CREDITS_PER_DAY` | free credits (messages) each visitor gets per day | `25` |
| `RATE_LIMIT_PER_MINUTE` | spam guard: messages per minute per visitor | `5` |
| `RATE_LIMIT_IP_PER_DAY` | messages per day from one network, like a whole school (backstop) | `800` |
| `OPENROUTER_MODEL` | OpenRouter model | `openrouter/free` (picks a free model automatically) |
| `MISTRAL_MODEL` | Mistral model | `mistral-small-latest` |
| `SITE_PASSWORD` | only if you want to make it private again | none |
| `GEMINI_MODEL` | which Gemini model | `gemini-3.6-flash` |
| `PROVIDERS` | order to try providers in, e.g. `groq,gemini,openrouter,mistral` | that order |

## Troubleshooting
- **"Nova is really busy right now"**: every free provider is maxed out at that moment. Add more provider keys, lower `MAX_CONTEXT_CHARS`, or lower the per-visitor limits.
- **"You've used all 25 of today's free credits"**: that's the credit limit working. Change it with `CREDITS_PER_DAY` (lower it if Nova is often busy, raise it if it never is).
- **"That AI model isn't available anymore"**: Groq retires models sometimes. Pick a current one at https://console.groq.com/docs/models and set the matching variable above.
- **Images don't work**: the vision model may have been retired. Set `GROQ_VISION_MODEL` to a current Groq model that supports images.
- **PDFs won't read**: the PDF reader loads from the jsDelivr CDN, so that site has to be reachable. Scanned PDFs (photos of pages) have no text, so screenshot them and attach as images instead.
- **"Couldn't read the link"**: some sites block bots, need a login, or only load with JavaScript (Instagram, TikTok, Google Docs, many school sites). Paste the text in instead.
- **"Web search wasn't available"**: Groq didn't allow its search tool on your plan, or you attached an image (the image model can't search). Nova still answers.
- **Mic button missing**: voice typing works in Chrome and Edge, not Firefox.

## Changing it
- Change the name and personality in `systemPrompt` in `api/chat.js`.
- Change the colors in the `:root` section at the top of `index.html`.
- Change the starter suggestions in `SUGGESTIONS` in `index.html`.
