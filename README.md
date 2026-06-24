# ironlabs-plugin

AI video production skills by IronLabs — creative direction, generation, analysis, e-commerce content, and download.

## Skills

| Skill | Description |
|-------|-------------|
| **director** | Creative director — single entry point for all video creation (product ads, short films, TikTok e-commerce, drama, comedy) |
| **gemini-gen** | Visual understanding & multimodal analysis via Gemini 2.5 Flash (product analysis, video script extraction, style extraction) |
| **renoise-gen** | AI video & image generation engine — OpenRouter connector, material pool, product design sheets, scene backgrounds |
| **video-download** | Video downloader (yt-dlp + Douyin/TikTok fallback) |

## Installation

### Claude Code

1. Add the marketplace:

```bash
claude plugin marketplace add IronLabsAI/ironlabs-plugin
```

2. Install the plugin:

```bash
claude plugin install ironlabs@ironlabs-plugin
```

### OpenClaw

```bash
openclaw plugins install @ironlabs/plugin
```

3. Launch Claude Code and run the setup command to connect your IronLabs account:

```
/ironlabs:setup
```

This will guide you through connecting your API key and enabling the real-time balance display in the status bar.

## Environment Variables

| Variable | Required By | Description |
|----------|------------|-------------|
| `IRONLABS_API_KEY` | All skills | IronLabs API key. Get one at https://studio.ironlabs.ai → API Keys |
| `IRONLABS_BASE_URL` | All skills | Optional. Override API base URL (e.g. for staging: `https://stg-chat.irona.ai`) |

## Connectors

Some skills require external connectors configured at **Settings → Connectors** in IronLabs:

| Connector | Required By | What it enables |
|-----------|------------|-----------------|
| **OpenRouter** | All skills | Video and image generation, visual analysis via Gemini 2.5 Flash |
