# n

Generated 2026-11-02T06:23:27.453Z · 9 tests · **9 passed** · 0 failed · 0 skipped · 816 ms


## packages/notifications/src/notification.service.test.ts

- ✅ NotificationService › instant classes are P1+P2 (P2 instant per decision) (4 ms)
- ✅ NotificationService › sends once per canonical hash (49 ms)
- ✅ NotificationService › caps at 10 per feed per hour and defers the rest (7 ms)
- ✅ NotificationService › does not record "sent" when Telegram is unconfigured (3 ms)
- ✅ NotificationService › message carries the class tag and strips markdown-breaking characters (12 ms)
- ✅ NotificationService › digest includes P3 + deferred, excludes instant-sent and internships (27 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › uses alert_channels when present: class + minScore filters, per-recipient dedupe, env channel ignored (2 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › follow-up reminders: due applications are announced once and the timeline records it (2 ms)
- ✅ NotificationService · per-user digest hour (v5) › serves each recipient at their own hour/timezone; env recipients at 08:00 IST (26 ms)
