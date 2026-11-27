# How to use

No install is needed. The demo is a web page that runs in your browser.

## 1. Get a free Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in with a Google account.
2. Click **Get API key**, then **Create API key**.
3. Copy the key. Keep it private and never put it in the code.

## 2. Open the demo

1. Download this repository (**Code → Download ZIP**) and unzip it.
2. Open `index.html` in Chrome or Edge. Keep the `css` and `js` folders next to it.
3. Paste your key in **Gemini API key**. Click **Save in this browser** if you don't want to paste it every time; it is stored only in your browser.

An internet connection is needed: the page calls Gemini and loads the spreadsheet reader.

## 3. Calculate charges

1. **Ticket copy:** click a sample (**flydubai**, **flynas** or **IndiGo**), paste your own ticket text, or switch to **Upload PDF / image**. Sample tickets are also in [`samples/tickets`](../samples/tickets).
2. **Request date & time:** when the change or refund is being asked for. It defaults to now. It decides which time window applies.
3. **Optional overrides:** Airline, Fare type and No. of pax are read from the ticket. Fill them only to override.
4. **Airline fare rules:** leave **Rule page link** blank to use the airline's official page (set up for flydubai, flynas, Air Arabia and IndiGo). For any other airline, paste its fare-rules page link.
5. **Airline fee sheet (optional):** upload the airline's Excel or CSV fee sheet to help find the zone and to cross-check amounts.
6. **Fare difference (optional):** add it if you know it, to see the full reissue amount.
7. Click **Calculate charges**. It takes a few seconds: first the ticket is read, then the airline's page.

## 4. Read the result

| Part | What it tells you |
| --- | --- |
| **Reissue / Refund charge** | Totals, with Allowed, Not permitted or Check manually |
| **Why a manual check is needed** | A plain reason for every sector that can't be calculated |
| **Airline sheet differs** | Where your fee sheet and the website disagree (the website amount is used) |
| **Zone used** | The zone, where it came from, and why |
| **Breakdown tables** | Per sector: time to departure, the airline's rule sentence, fee per passenger, passengers, subtotal |
| **Check before quoting** | The airline's footnotes and any conflicts between sources |
| **Fare rules source** | Each page read, whether it was read live, and when |
| **Show what Gemini extracted** | The raw data Gemini returned, for checking |

Always check the quoted rule lines before giving an amount to a customer.

## Troubleshooting

| Message | What to do |
| --- | --- |
| "Paste your Gemini API key first" | Paste the key from AI Studio |
| "… is busy" / "All Gemini models are busy" | Google's servers are busy. Wait a minute and try again. The page already retries and switches models |
| A message mentioning **quota** | You've reached the free-tier limit. Wait, or use another key |
| "Gemini could not read the fare rules" | The airline page couldn't be read (for example it needs JavaScript). Open **Airline page can't be read? Paste the rules instead**, paste the rule text from the airline's site, and calculate again |
| "No rule page link is set up" | Paste the airline's fare-rules page link in **Rule page link** |
| "No rules found for fare type …" | Type the airline's fare name in **Fare type** (e.g. Value, Lite, Flex) |
| "The spreadsheet reader could not load" | Check your internet connection and reload the page |

## Adding an airline

Add its official rule page links to `AIRLINE_SOURCES` in [`js/airlines.js`](../js/airlines.js):

```js
"OV": {name:"SalamAir", urls:["https://www.salamair.com/en/plan/fares-bundles"]},
```

Use only the airline's own pages, never blogs or booking sites. No other code changes are needed. See [airlines.md](airlines.md) for how each airline publishes its rules.
