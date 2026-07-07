---
name: ironlabs:setup
description: Connect your IronLabs account by configuring your API key
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# /ironlabs:setup

Connect Claude Code to your IronLabs account so all IronLabs skills can authenticate automatically.

## Step 1: Check for Existing Key

Check if `IRONLABS_API_KEY` is already set:

```bash
echo "${IRONLABS_API_KEY:+SET}"
```

If it outputs `SET`, skip to Step 3.

## Step 2: Get and Save API Key

1. Open the IronLabs API keys page:
   ```bash
   open "https://studio.ironlabs.ai"
   ```

2. Tell the user:
   > IronLabs opened. Go to **API Keys → Create new API Key**, copy the key (starts with `sk-`, shown only once), then paste it here.

3. Use AskUserQuestion to ask for the API key.

4. Save to `~/.claude/settings.json` under the `env` block. Merge with existing values — do not overwrite other keys:
   ```json
   {
     "env": {
       "IRONLABS_API_KEY": "<user's key>"
     }
   }
   ```

## Step 3: Verify the Connection

```bash
curl -s "${IRONLABS_BASE_URL:-https://www.chat.ironlabs.ai}/api/v1/chat/model" \
  -H "Authorization: Bearer ${IRONLABS_API_KEY}" | head -c 200
```

A successful response is a JSON array. If you get a `401`, the key is invalid — ask the user to double-check and re-enter it.

## Step 4: Optional — Set a Custom Base URL

Ask the user if they want to connect to a staging or self-hosted instance instead of `https://www.chat.ironlabs.ai/`.

If yes, use AskUserQuestion to collect the base URL, then save it alongside the API key:

```json
{
  "env": {
    "IRONLABS_API_KEY": "<user's key>",
    "IRONLABS_BASE_URL": "<user's base URL>"
  }
}
```

## Step 5: Detect Runtime

Find a JavaScript runtime (prefer bun for performance):

```bash
command -v bun 2>/dev/null || command -v node 2>/dev/null
```

If empty, tell the user to install bun (https://bun.sh) or Node.js (https://nodejs.org), then re-run `/ironlabs:setup`.

Save the runtime absolute path as `{RUNTIME_PATH}`.

## Step 6: Find Plugin Directory

```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
ls -d "$CLAUDE_DIR"/plugins/cache/ironlabs-plugin/ironlabs/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-
```

Save as `{PLUGIN_DIR}`. If empty, the plugin may not be installed via marketplace — ask the user to verify installation.

## Step 7: Generate and Test StatusLine Command

Generate the statusLine command:

**If runtime is bun:**
```
bash -c 'plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/ironlabs-plugin/ironlabs/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "{RUNTIME_PATH}" --env-file /dev/null "${plugin_dir}src/index.ts"'
```

**If runtime is node:**
```
bash -c 'plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/ironlabs-plugin/ironlabs/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec npx tsx "${plugin_dir}src/index.ts"'
```

Test the command:
```bash
echo '{}' | {GENERATED_COMMAND} 2>&1
```

Should output a line like `IronLabs: $1.23`. If it errors, debug before proceeding.

## Step 8: Apply StatusLine Config

Read `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`.

**If a `statusLine` already exists** and its command does NOT contain "ironlabs-plugin":
1. Save the existing statusLine command to `~/.ironlabs/previous-statusline.json`:
   ```json
   { "command": "<existing statusLine command>" }
   ```
   Create the `~/.ironlabs/` directory if needed. This command is re-executed via shell on
   every status refresh (see `src/index.ts`), so restrict the file to the current user:
   ```bash
   chmod 600 ~/.ironlabs/previous-statusline.json
   ```
2. Tell the user: "Your existing statusLine will be preserved and merged with the IronLabs credit display."

**Then** merge in our statusLine config, preserving all other existing settings:

```json
{
  "statusLine": {
    "type": "command",
    "command": "{GENERATED_COMMAND}"
  }
}
```

## Done

Tell the user:

> ✅ Your IronLabs account is now connected.
>
> **Restart Claude Code** to activate. After restart you'll see:
> - Your real-time credit balance in the status bar
> - Low balance warnings when credits are running out
> - Type `/ironlabs:add-credits` anytime to top up
>
> The following skills will be available:
> - `director` — AI video creative director (entry point for all video creation)
> - `ironlabs-gen` — video and image generation via OpenRouter
> - `gemini-gen` — visual analysis and multimodal understanding via Gemini
> - `video-download` — download videos from YouTube, TikTok, and 1000+ platforms
>
> Some skills require external connectors configured at **Settings → Connectors** in IronLabs:
>
> | Skill | Connector | What it enables |
> |-------|-----------|-----------------|
> | `ironlabs-gen`, `director` | OpenRouter | Video/image generation |
>
> `gemini-gen` needs no external connector — it runs natively through Irona's LLM gateway.
