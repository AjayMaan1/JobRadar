# notif

Generated 2026-11-02T05:18:50.575Z · 8 tests · **8 passed** · 0 failed · 0 skipped · 1259 ms


## packages/notifications/src/notification.service.test.ts

- ✅ NotificationService › instant classes are P1+P2 (P2 instant per decision) (7 ms)
- ✅ NotificationService › sends once per canonical hash (99 ms)
- ✅ NotificationService › caps at 10 per feed per hour and defers the rest (25 ms)
- ✅ NotificationService › does not record "sent" when Telegram is unconfigured (13 ms)
- ✅ NotificationService › message carries the class tag and strips markdown-breaking characters (0 ms)
- ✅ NotificationService › digest includes P3 + deferred, excludes instant-sent and internships (40 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › uses alert_channels when present: class + minScore filters, per-recipient dedupe, env channel ignored (1 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › follow-up reminders: due applications are announced once and the timeline records it (2 ms)
