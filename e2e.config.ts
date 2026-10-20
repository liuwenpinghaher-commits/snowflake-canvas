import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'

// 这个框架的应用地址写在 app.url。这里的 baseURL 只指向本机临时隔离服务 (:18093)，不触碰 :8093 生产服务，也不指向公网。
const baseURL = process.env.SNOWFLAKE_E2E_URL || 'http://127.0.0.1:18093'

export default {
  tests: ['e2e/**/*.e2e.ts', 'e2e-got-s3/**/*.e2e.ts'],
  retries: 0,
  workers: 1,
  timeout: 180000,
  targets: [
    {
      engine: web(),
      app: {
        url: baseURL,
        command: {
          executable: 'node',
          args: ['e2e/start-test-server.mjs'],
          startupTimeout: 30000,
        },
        readyUrl: `${baseURL}/api/health`,
      },
    },
  ],
} satisfies E2EConfig
