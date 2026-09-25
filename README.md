# تيّار · Tayyar

<div dir="rtl">

**تيّار** خادم مفتوح المصدر يقرأ سجلات شفافية الشهادات العامة باستمرار، فيبث كل شهادة TLS جديدة لحظة تسجيلها عبر WebSocket، ويقدّم إلى جانب ذلك صفحة حية بالعربية والإنجليزية وأداة لسطر الأوامر تطبع ما يطابق الكلمات التي تراقبها، لذا يصلح أساساً لرصد نطاقات التصيد الاحتيالي وانتحال العلامات لحظة ظهورها.

## ما يميّزه

يقرأ تيّار نوعي السجلات معاً، أي السجلات التي تتبع RFC 6962 والسجلات الثابتة التي تُقرأ من ملفات tile، ويتحقق من توقيع كل رأس شجرة بمفتاح السجل نفسه قبل أن يثق بحجمها، ولا يعتمد على أي مكتبة خارجية.

## كيف يعمل

يجلب تيّار القائمة العامة للسجلات الموثوقة ويختار منها ما يقبل الشهادات اليوم، ثم يشغّل لكل سجل عاملاً مستقلاً يقرأ رأس الشجرة الموقَّع ويتحقق من توقيعه، فإن كبرت الشجرة جلب المدخلات الجديدة إما عبر `get-entries` وإما من ملفات tile.

بعد ذلك يحذف تيّار النسخ المكررة لأن كل شهادة تُسجَّل في سجلين أو ثلاثة، ثم يحلل الشهادة مرة واحدة ويبثها على المسارات الثلاثة، بينما يتعلم من ردود كل سجل حجم الدفعة التي يقبلها ويخفف ضغطه إن ردّ السجل بالرمز 429 ثم يرفعه تدريجياً، لذا يواكب السجلات المزدحمة دون أن يثقل عليها.

وفي تجربة حية بتاريخ 25 سبتمبر 2026 قرأ تيّار 49 سجلاً، فبث نحو 1,200 شهادة فريدة في الثانية مستهلكاً قرابة ربع نواة واحدة من المعالج.

## التشغيل

يعمل تيّار على Node 22 أو أحدث دون أي مكتبة خارجية، ولا يحتاج إلى تثبيت إذ يكفي تشغيله عبر npx، ويستمع الخادم على العنوان المحلي وحده ما لم تطلب غير ذلك كما في السطر الثاني:

</div>

```sh
npx github:SiteQ8/Tayyar serve
npx github:SiteQ8/Tayyar serve --host 0.0.0.0 --port 8080
```

<div dir="rtl">

افتح بعد ذلك العنوان `http://127.0.0.1:4000/` لترى البث مباشرة، واستخدم الأمر watch لتطبع في الطرفية الشهادات التي تطابق كلماتك، ومنها أسماء الجهات التي تحميها من انتحال نطاقاتها:

</div>

```sh
npx github:SiteQ8/Tayyar watch --keyword shop,bank --match '\.kw$'
npx github:SiteQ8/Tayyar watch --format json --duration 600 > certs.jsonl
npx github:SiteQ8/Tayyar logs --probe
```

<div dir="rtl">

تجد المسارات وحقول الرسائل في القسم الإنجليزي أدناه لأنها أسماء تقنية لا تتغير بين اللغتين، وكلها مثبتة باختبارات تفشل إن تغيّر أي حقل منها.

## الأمان والخصوصية

لا ترسل الصفحة الحية أي طلب إلى طرف ثالث ولا تحمّل خطوطاً من الخارج، ويقيّد الخادم عدد المتصلين من كل عنوان ويفصل المتصل الذي لا يواكب البث بدل أن يبطئ الجميع، بينما تبقى بيانات السجلات عامة بطبيعتها فلا يحمل البث شيئاً ليس فيها أصلاً.

## التطوير

تُفرض قواعد المشروع باختبارات تفشل عند مخالفتها، ومنها مطابقة العدد والمعدود في الواجهة العربية وخلوّ الجمل العربية من النقاط في وسطها وخلوّ الملفات من الشرطات الطويلة وثبات حقول الرسائل، وتعمل كلها دون اتصال لأنها تستخدم بيانات حقيقية سُجّلت من السجلات:

</div>

```sh
npm test
npm run preflight
```

<div dir="rtl">

## الترخيص

الشيفرة متاحة بترخيص MIT.

</div>

## What it is

**Tayyar** (Arabic for a current, as in a stream) is an open source server that reads the public Certificate Transparency logs continuously and streams every new TLS certificate over WebSocket the moment it is logged. It also serves a live viewer page in Arabic and English, and a command line tool that prints the certificates matching the words you watch for, which makes it a base for spotting phishing and brand impersonation domains as they appear.

## What sets it apart

- It reads both kinds of CT log: RFC 6962 logs, and static CT API logs served as tiles.
- It checks each log's signature on every tree head before trusting the size it reports.
- It has no dependencies and needs only Node 22 or later.
- It listens on 127.0.0.1 unless told otherwise.

## How it works

1. It loads Google's public list of trusted CT logs and keeps the logs that accept certificates today: usable or qualified, with a temporal shard that is current.
2. It runs one watcher per log. Each watcher reads the signed tree head (`get-sth`, or `/checkpoint` for static CT logs) and checks the log's signature on it.
3. It fetches the new entries: `get-entries` from RFC 6962 logs, data tiles and `/issuer/` from static CT logs.
4. It drops the copies of a certificate that arrive from other logs, parses each certificate once, and broadcasts it.

Watchers learn each log's page size from its answers (some logs return 32 entries per call, most return 256), pipeline requests while catching up, halve their concurrency when a log answers 429, and jump to the newest entries when they fall too far behind, so the stream stays live.

In a live run on 25 September 2026, Tayyar read 49 logs and published about 1,200 unique certificates per second using about a quarter of one CPU core.

## Run it

Node 22 or later, no dependencies:

```sh
npx github:SiteQ8/Tayyar serve                               # viewer and streams at http://127.0.0.1:4000/
npx github:SiteQ8/Tayyar serve --host 0.0.0.0 --port 8080    # reachable from other machines
npx github:SiteQ8/Tayyar watch --keyword shop,bank --match '\.kw$'
npx github:SiteQ8/Tayyar watch --format json --duration 600 > certs.jsonl
npx github:SiteQ8/Tayyar logs --probe
```

`tayyar --help` lists every option, including `--state` to save each log's position and resume from it, `--backfill` to start behind the newest entries, and `--verify enforce` to refuse any tree head whose signature does not check out.

## Endpoints

| Path | What it sends |
|---|---|
| `/` (WebSocket) | `certificate_update` messages without the DER bytes or the chain |
| `/full-stream` (WebSocket) | the same messages with `as_der` and the chain |
| `/domains-only` (WebSocket) | `dns_entries` messages with the names only |
| `/latest.json` | the 25 most recent certificates, oldest first |
| `/example.json` | the most recent certificate in full |
| `/stats` | engine, log and client figures |
| `/healthz` | liveness for load balancers |

## Messages

Every certificate is published as one `certificate_update` message. These fields are fixed by the tests, so a client can rely on them:

| Field | Meaning |
|---|---|
| `message_type` | `certificate_update`, `dns_entries` or `heartbeat` |
| `data.update_type` | `X509LogEntry` for an issued certificate, `PrecertLogEntry` for a precertificate |
| `data.cert_index` | the entry's index in its log |
| `data.cert_link` | where the entry can be fetched from its log |
| `data.seen` | when Tayyar published it, in Unix seconds |
| `data.source` | the log's `name` and `url` |
| `data.leaf_cert.all_domains` | the names the certificate covers |
| `data.leaf_cert.subject` and `data.leaf_cert.issuer` | `C`, `ST`, `L`, `O`, `OU`, `CN`, `emailAddress` and `aggregated` |
| `data.leaf_cert.not_before` and `data.leaf_cert.not_after` | validity, in Unix seconds |
| `data.leaf_cert.serial_number` | the serial in hex |
| `data.leaf_cert.signature_algorithm` | for example `sha256, ecdsa` |
| `data.leaf_cert.is_ca` | whether the certificate may issue others |
| `data.leaf_cert.fingerprint`, `data.leaf_cert.sha1` and `data.leaf_cert.sha256` | hashes of the DER bytes |
| `data.leaf_cert.extensions` | decoded extensions such as `subjectAltName` and `keyUsage` |
| `data.leaf_cert.as_der` and `data.chain` | on `/full-stream` only |

A heartbeat arrives every 30 seconds. Clients do not need to send pings: the server pings them and drops connections that stop answering. This runs in a browser or in Node 22:

```js
const ws = new WebSocket('ws://127.0.0.1:4000/');
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.message_type === 'certificate_update') console.log(message.data.leaf_cert.all_domains);
};
```

## Security and privacy

The viewer page makes no third-party requests and loads no web fonts. The server listens on 127.0.0.1 unless told otherwise, limits WebSocket clients per address (`--max-per-ip`), disconnects clients that cannot keep up rather than slowing everyone down, and serves its page with a strict Content Security Policy. Everything it streams is already public in the logs.

## Development

```sh
npm test            # unit and end-to-end tests, offline
npm run preflight   # syntax, secret scan and README links, then the tests
```

The tests run offline against real data recorded from public CT logs: part of a static CT data tile with its issuers, `get-entries` output, and signed tree heads. Project rules are enforced by failing tests rather than by review: Arabic number agreement in the interface, no full stop in the middle of an Arabic sentence, no long dashes anywhere, and message fields that match this document.

## License

MIT
