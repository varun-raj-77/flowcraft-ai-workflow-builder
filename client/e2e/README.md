# FlowCraft browser tests

The Playwright suite intercepts every `/api` request with an in-memory fake.
It never calls Railway, Anthropic, or any production service and does not use
real credentials.

Install Chromium once, then run the suite:

```sh
npx playwright install chromium
npm run test:e2e
```

Failure traces, screenshots, and videos are written to `test-results/`; the
HTML report is written to `playwright-report/`. Both paths are gitignored.
