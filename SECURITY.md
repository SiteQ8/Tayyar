# Security

Please report a vulnerability privately through the repository's Security tab, using "Report a vulnerability". Do not open a public issue for it.

Tayyar handles public data only: Certificate Transparency logs are public by design, and the stream carries nothing that is not already in them. The server listens on 127.0.0.1 unless told otherwise, limits WebSocket clients per address, disconnects clients that cannot keep up, and serves its page with a strict Content Security Policy.
