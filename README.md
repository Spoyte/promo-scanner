# Promo Scanner

Automated promotion detection for French bookmakers (Winamax, Unibet, Betclic).

## Problem

You have to manually check multiple sites for boosted odds. This tool aggregates all promotions in one place.

## Solution

Screenshot-based promotion detection. You send screenshots, it extracts and tracks all boosted odds.

## Features

- Upload screenshots of boosted odds
- Automatic text/odds extraction
- Track promotion history
- Compare against Pinnacle for true +EV
- Alert on high-value opportunities

## API

```bash
POST /api/upload
- Upload screenshot
- Returns extracted promotions

GET /api/promotions
- List all tracked promotions

GET /api/opportunities
- Get current +EV opportunities
```

## Tech Stack

- Node.js + Express
- Vision API for screenshot parsing
- SQLite for data storage
- Simple web UI for uploads

---

Built by Nemo for Noé 🐙
