# Changelog

## 0.1.0 (25 September 2026)

First release.

- Reads every usable RFC 6962 and static CT log in Google's list of trusted CT logs, and checks the signature on every tree head and checkpoint.
- Streams certificates over WebSocket at `/`, `/full-stream` and `/domains-only`, with `/latest.json`, `/example.json`, `/stats` and `/healthz`.
- Drops the copies of a certificate that arrive from other logs, learns each log's page size, and backs off when a log answers 429.
- Command line: `serve`, `watch` with keyword and regular expression filters, and `logs` with a live signature probe.
- Live viewer page in Arabic and English that makes no third-party requests.
- No dependencies. Needs Node 22 or later.
