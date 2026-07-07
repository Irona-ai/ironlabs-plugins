---
name: ironlabs:add-credits
description: Check your IronLabs credit balance and open the billing page
---

# /ironlabs:add-credits

Check your current credit balance and add more credits to your IronLabs account.

## Check Balance

```bash
BASE_URL="${IRONLABS_BASE_URL:-https://www.chat.ironlabs.ai/api/v1}"
curl -s "$BASE_URL/chat/balance" \
  -H "Authorization: Bearer $IRONLABS_API_KEY" | jq '.'
```

Or via the CLI: `node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs credit me`

To estimate the cost of a generation before running it: `node ${CLAUDE_PLUGIN_ROOT}/skills/ironlabs-gen/ironlabs-cli.mjs credit estimate --model <model> --duration <n>`

## Add Credits

Open the billing page in your browser:

```
https://www.chat.ironlabs.ai/
```

Go to **Settings → Billing** to top up your balance or manage your subscription.
