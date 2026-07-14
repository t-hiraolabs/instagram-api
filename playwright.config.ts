// 「ストーリー作成」統合フェーズ5: Playwright回帰テスト基盤。
// このリポジトリには従来テスト基盤が一切存在しなかったため、今回新設する。
// expo start --webをwebServerとして自動起動し、e2e/配下のテストを実行する。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
    viewport: { width: 420, height: 900 },
    // devices['Desktop Chrome']は使わない。それをスプレッドするとhasTouch:falseで
    // 上書きされ、CDPのInput.dispatchTouchEventがgesture-handlerに届かなくなる
    // （実機での指操作を検証するのが目的のため、タッチエミュレーションが必須）。
    hasTouch: true,
    launchOptions: {
      args: ['--touch-events=enabled'],
    },
  },
  projects: [
    { name: 'chromium', use: {} },
  ],
  webServer: {
    command: 'CI=1 EXPO_OFFLINE=1 npx expo start --web --offline --port 8081',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
