# Changelog

## 0.2.0 (25 September 2026)

A full interface, a watchlist and alerts.

- Watchlist of brands and patterns, checked against every name on every new certificate.
- Look-alike detection: the real domain written inside another, look-alike letters from other scripts, digits and letter pairs for letters, misspellings, another ending, lure words in English and Arabic, and Arabic letters that read alike, such as the Persian and Arabic kaf.
- Alerts with a score, reasons in plain words, statuses, notes, repeats counted within a day, CSV export and DNS lookups.
- Webhooks as JSON or text, signed with HMAC SHA-256, retried after a failure.
- Interface in Arabic and English: live stream with the last hour's issuers and endings, alerts, watchlist with a name tester, import and export, search over the last 500,000 certificates, and the state of every log.
- Optional access token with a strict session cookie, and changes refused from other sites.
- `--data` keeps the watchlist, alerts and log positions between runs.
- Command line: `check` tests names against a watchlist file, and `watch --watchlist` prints only the certificates that imitate a watched brand.
- WebSocket stream of alerts at `/alerts`.
- Site at https://tayyar.3li.info.

## 0.1.0 (25 September 2026)

First release.

- Reads every usable RFC 6962 and static CT log in Google's list of trusted CT logs, and checks the signature on every tree head and checkpoint.
- Streams certificates over WebSocket at `/`, `/full-stream` and `/domains-only`, with `/latest.json`, `/example.json`, `/stats` and `/healthz`.
- Drops the copies of a certificate that arrive from other logs, learns each log's page size, and backs off when a log answers 429.
- Command line: `serve`, `watch` with keyword and regular expression filters, and `logs` with a live signature probe.
- Live viewer page in Arabic and English that makes no third-party requests.
- No dependencies. Needs Node 22 or later.
