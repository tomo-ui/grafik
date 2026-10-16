import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'docs', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // P-04: daty tylko przez src/domain/dates.ts
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='Date']:matches([arguments.0.type='TemplateLiteral'], [arguments.0.raw=/^[\"']/])",
          message: 'P-04: nie parsuj dat ze stringów przez new Date(); użyj src/domain/dates.ts',
        },
        {
          selector: "CallExpression[callee.property.name='toISOString']",
          message: 'P-04: toISOString() zwraca datę UTC; użyj toISODate() z src/domain/dates.ts',
        },
      ],
    },
  },
);
