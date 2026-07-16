import { defineConfig } from 'vitest/config';

process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/flowcraft_test';
process.env.CLIENT_URL ??= 'http://localhost:3000';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
  },
});
