# Product

## Platform

web

## Users

Security teams first: analysts who watch for names that imitate their organisation's brands and domains, working in Arabic and English, mostly in Kuwait and the Arabian Gulf. Developers who connect the stream or the alerts to their own tools come second.

## Product Purpose

Tayyar reads the public Certificate Transparency logs continuously, streams every new TLS certificate the moment it is logged, and checks every name on it against a watchlist, so a look-alike of a watched brand is seen when its certificate is issued. It is shared to show how Certificate Transparency monitoring works: as is, without warranty, run by each user on their own machine.

## Positioning

Tayyar reads both kinds of CT log, RFC 6962 and static tiles, and checks each log's signature on every tree head. Its look-alike detection understands Arabic letters that read alike and Arabic lure words, and every alert draws its evidence on the name itself. It has no dependencies, serves its own fonts and makes no third-party requests.

## Operating Context

The interface runs locally (`npx github:SiteQ8/Tayyar serve`) and opens in a browser at 127.0.0.1, optionally behind an access token. Alerts arrive in a queue triaged from the keyboard, webhooks carry them to chat tools, and `/metrics` feeds monitoring systems. The site lives at tayyar.3li.info on GitHub Pages.

## Capabilities and Constraints

- Interface views: Live, Alerts, Watchlist, Search and Logs, which opens with the How it works pipeline.
- Arabic first, right to left, with a complete English twin; every string exists in both languages, and tests enforce it.
- No reference to any other product or tool, anywhere.
- Screens and examples use invented names reserved for examples, never real brands or real domains.
- No third-party requests: fonts and images are served by Tayyar and the site themselves.
- No long dashes; an Arabic sentence carries one full stop, at its end.
- Nothing may incur a cost on GitHub.
- The disclaimers stay: shared to show how it works, as is and without warranty.

## Brand Commitments

- Name: تيّار / Tayyar, a current, as in a stream.
- Readex Pro sets both languages, Arabic and English.
- The wave mark.
- In the interface, amber marks a precertificate, sea green an issued certificate, and coral a match or a high severity alert; severity is never carried by colour alone.

## Evidence on Hand

- Real interface screenshots in `docs/img`, with invented names on every alert and watchlist screen.
- Live figures measured on 25 September 2026: 49 logs read, about 1,200 unique certificates a second, about a quarter of one CPU core.
- No customers, testimonials, benchmarks or prices exist, and none may be invented.

## Product Principles

1. Show the evidence: every alert says why, on the name itself.
2. Arabic is first class, never a translation.
3. Nothing leaves the machine unless the user sends it.
4. Honest about what it is: a demonstration that carries no liability.

## Accessibility & Inclusion

Triage works from the keyboard, focus is always visible, reduced motion is respected, severity is carried by words and position as well as colour, and both light and dark themes are complete.
