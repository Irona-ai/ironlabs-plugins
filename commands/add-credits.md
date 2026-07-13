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

## Subscription Plans

| Plan | Price | Routing Requests | Key Features |
|---|---|---|---|
| Exploration | Free | Up to 10k/month | Intelligent cost/latency optimization, fallback routing, personalized router, prompt adaptation |
| Pro | $50/month | Unlimited (overage: $10/million after the first 10k free requests) | All Exploration features + multimodal input support, data privacy via hashing |
| Enterprise | Custom Pricing | Custom | All Pro features + VPC deployments, custom integration & support, Slack hands-on support, permission management, self-hosting |

> **Note:** Unused message or image credits reset each billing cycle and do not carry forward.
