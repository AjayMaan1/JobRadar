# facts

Generated 2026-11-02T06:02:07.267Z · 7 tests · **7 passed** · 0 failed · 0 skipped · 342 ms


## packages/extractor/src/geo/facts.test.ts

- ✅ job facts reproduce the legacy classifier (golden gate, HLD §4) › every classifier fixture maps to the same tier through facts + legacy preset (125 ms)
- ✅ structured geo facts › parses location lines into country / metro / region (1 ms)
- ✅ structured geo facts › restriction phrases become exclusive allow lists and eligibility is per country (0 ms)
- ✅ structured geo facts › region restrictions expand to member countries (1 ms)
- ✅ structured geo facts › timezone windows are evaluated against the candidate offset (1 ms)
- ✅ structured geo facts › worldwide beats a body restriction; location-line restriction beats everything (1 ms)
- ✅ structured geo facts › salary carries a USD pivot (1 ms)
