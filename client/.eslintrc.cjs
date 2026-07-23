module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  ignorePatterns: [
    '.next/',
    'coverage/',
    'node_modules/',
    'playwright-report/',
    'test-results/',
    'tsconfig.tsbuildinfo',
  ],
  overrides: [{
    files: ['**/*.ts', '**/*.tsx'],
    extends: ['plugin:@typescript-eslint/recommended'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: __dirname,
    },
    plugins: ['@typescript-eslint'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false },
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'react-hooks/exhaustive-deps': 'error',
    },
  }],
};
