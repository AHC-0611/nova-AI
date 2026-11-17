# Nova AI

Your own ChatGPT-style AI site that anyone can use with no sign-up. It runs on a free vercel.app address and pools free AI providers (Groq, plus optional Gemini, OpenRouter and Mistral).

## Features
- **Chat history**: saved chats in a sidebar, with search, rename and delete
- **Smart / Fast models**: Smart (GPT-OSS 120B) for best answers, Fast (GPT-OSS 20B) for quick ones
- **Images**: attach, paste or drag in up to 4 images and ask about them (homework photos, screenshots, memes)
- **Files**: PDF, Word (.docx), text, CSV and code files. Nova reads them and answers about them
- **Links**: paste up to 3 links and Nova opens the pages and answers from them (shown under Sources)
- **Web search**: Nova searches the web itself (DuckDuckGo, then Wikipedia), opens the top results and answers from them, with sources. Add a free `TAVILY_API_KEY` for the most reliable results. This works on Groq's free plan and uses far less of its limit than Groq's own search tool did
- **Voice**: tap 🎤 to talk instead of typing; 🔊 reads answers aloud (pick the voice in Settings)
- **Edit & retry**: edit any message you sent, or hit Try again for a new answer
- **Custom instructions**: tell Nova about yourself or how to reply (Settings)
- Tables, code blocks with copy buttons, dark/light theme, download a chat as a file, works on phones
- Shortcut: Ctrl+Shift+O starts a new chat

Chats are saved in each visitor's own browser, not on the server. Free AI providers (especially Gemini and Mistral) may use what people type to improve their models, so the site reminds people not to share private info.

## Setup (about 15 minutes)

Nova is set up as a **public site**: anyone with the link can chat, no password or sign-up. Each visitor gets a fair-use limit (30 messages an hour, 150 a day by default) so nobody can use up the free AI for everyone else.

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
| `RATE_LIMIT_PER_HOUR` | messages each visitor can send per hour | `30` |
| `RATE_LIMIT_PER_DAY` | messages each visitor can send per day | `150` |
| `RATE_LIMIT_IP_PER_HOUR` | messages per hour from one network, like a whole school (backstop) | `400` |
| `OPENROUTER_MODEL` | OpenRouter model | `openrouter/free` (picks a free model automatically) |
| `MISTRAL_MODEL` | Mistral model | `mistral-small-latest` |
| `SITE_PASSWORD` | only if you want to make it private again | none |
| `GEMINI_MODEL` | which Gemini model | `gemini-3.6-flash` |
| `TAVILY_API_KEY` | optional, free key from https://tavily.com for better web search | none |
| `GROQ_BROWSER_SEARCH` | set to `1` to use Groq's own search tool too (uses the free limit up much faster) | off |
| `PROVIDERS` | order to try providers in, e.g. `groq,gemini,openrouter,mistral` | that order |

## Troubleshooting
- **"Nova is really busy right now"**: every free provider is maxed out at that moment. Add more provider keys, lower `MAX_CONTEXT_CHARS`, or lower the per-visitor limits.
- **"You've reached the limit of 30 messages per hour"**: that's the fair-use limit working. Change it with `RATE_LIMIT_PER_HOUR`.
- **"That AI model isn't available anymore"**: Groq retires models sometimes. Pick a current one at https://console.groq.com/docs/models and set the matching variable above.
- **Images don't work**: the vision model may have been retired. Set `GROQ_VISION_MODEL` to a current Groq model that supports images.
- **PDFs won't read**: the PDF reader loads from the jsDelivr CDN, so that site has to be reachable. Scanned PDFs (photos of pages) have no text, so screenshot them and attach as images instead.
- **"Couldn't read the link"**: some sites block bots, need a login, or only load with JavaScript (Instagram, TikTok, Google Docs, many school sites). Paste the text in instead.
- **"Nova's free AI is maxed out for the moment"**: Groq's free plan allows only so many words per minute and per day for the whole site. Nova switches from Smart to Fast automatically when Smart is maxed out. Wait a minute, or add another provider key (like OpenRouter) for more capacity.
- **"Web search wasn't available"**: the search sites didn't answer that time. Add a free `TAVILY_API_KEY` to make search more reliable.
- **Mic button missing**: voice typing works in Chrome and Edge, not Firefox.

## Changing it
- Change the name and personality in `systemPrompt` in `api/chat.js`.
- Change the colors in the `:root` section at the top of `index.html`.
- Change the starter suggestions in `SUGGESTIONS` in `index.html`.
