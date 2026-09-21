# SAOMI Vercel Telegram authoritative source

This directory is the canonical production source for the SAOMI Telegram server routes.

Rules:
- /api/telegram accepts trade messages only.
- Symbol validation comes from Binance USD-M exchangeInfo and requires status=TRADING + contractType=PERPETUAL.
- There is no 7-symbol whitelist and no carrier/AKTARIM/fake-symbol compatibility path.
- Entry, Stop and TP1/TP2/TP3 must be real positive finite values. Null is never coerced to zero.
- System messages are separated under /api/telegram/system and are not formatted as trades.
- Scanner/lifecycle production probes must accept ARBUSDT and report symbolPolicy=binance-usdm-trading-perpetual before delivery is enabled.

Deployment is not considered healthy until production GET /api/telegram?symbol=ARBUSDT returns configured=true, symbolAccepted=true and the expected symbolPolicy.
