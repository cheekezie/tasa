@AGENTS.md

## Money

Amounts are integer kobo everywhere, typed `Kobo` (`lib/money.ts`), exactly as the API sends them. Only
`formatNaira` turns kobo into naira (for display), and only `parseAmountInput` turns typed naira into kobo.
No `/ 100` or `* 100` on money anywhere else; `kobo()` is only for API values and literal constants.
