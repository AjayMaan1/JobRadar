# egress

Generated 2026-11-02T05:42:18.653Z · 16 tests · **16 passed** · 0 failed · 0 skipped · 1059 ms


## packages/crawler/src/gateway/egress.test.ts

- ✅ egress guard (audit NEW-27) › classifies private / special addresses (7 ms)
- ✅ egress guard (audit NEW-27) › blocks schemes, internal names, literal private IPs and credentials (2 ms)
- ✅ egress guard (audit NEW-27) › blocks names that resolve to private addresses (incl. mixed public+private) and caches the verdict (1 ms)
- ✅ egress guard (audit NEW-27) › lets unresolvable names through (fetch fails on its own; sandbox fake fetch keeps working) (1 ms)
- ✅ egress guard (audit NEW-27) › readBodyCapped truncates oversized bodies (30 ms)

## packages/crawler/src/gateway/fetch-gateway.test.ts

- ✅ FetchGateway classification › 200 JSON → changed with etag/hash; same hash next time → unchanged; 304 → unchanged (154 ms)
- ✅ FetchGateway classification › 404 → not_found, 5xx → error, 403 → blocked (circuit opens 6h), challenge HTML on 200 → blocked (137 ms)
- ✅ FetchGateway classification › challenge page served with 200 to an API call is classified as blocked (9 ms)
- ✅ FetchGateway classification › 429 honours Retry-After and opens the circuit; half-open probe closes it on success (11 ms)
- ✅ FetchGateway politeness › sends the JobRadar UA and conditional headers (4 ms)
- ✅ FetchGateway politeness › enforces the daily budget and the probe budget (205 ms)
- ✅ FetchGateway politeness › probe budget is independent of the list budget (116 ms)
- ✅ FetchGateway politeness › respects robots.txt for HTML fetches only (7 ms)
- ✅ FetchGateway politeness › host kill switch stops all traffic immediately (2 ms)
- ✅ FetchGateway politeness › token bucket spaces requests by minIntervalMs after the burst (108 ms)
- ✅ FetchGateway politeness › logs a fetch_run per request with outcome + host (5 ms)
