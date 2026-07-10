---
name: ironlabs:add-credits
description: Check your IronLabs credit balance and open the billing page
---

# /ironlabs:add-credits

Check your current credit balance and add more credits to your IronLabs account.

## Check Balance

```bash
BASE_URL="${IRONLABS_BASE_URL:-https://www.chat.ironlabs.ai}"
curl -s "$BASE_URL/api/v1/chat/balance" \
  -H "Authorization: Bearer $IRONLABS_API_KEY" | jq '.'
```

## Add Credits

Open the billing page in your browser:

```
https://www.chat.ironlabs.ai
```

Go to **Settings → Billing** to top up your balance or manage your subscription.

## Subscription Plans

| Plan | Price | Routing Requests | Key Features |
|---|---|---|---|
| Exploration | Free | Up to 10k/month | Intelligent cost/latency optimization, fallback routing, personalized router, prompt adaptation |
| Pro | $75/month | Unlimited (overage: $10/million) | All Exploration features + multimodal support, data privacy hashing |
| Enterprise | Custom | Custom | All Pro features + VPC deployment, custom integrations, dedicated Slack support, permission controls, self-hosting |

> **Note:** Unused credits reset each billing cycle and do not carry forward.

Visit [https://www.chat.ironlabs.ai](https://www.chat.ironlabs.ai) to upgrade or view full pricing at [https://docs.irona.ai/pricing/pricing](https://docs.irona.ai/pricing/pricing).
