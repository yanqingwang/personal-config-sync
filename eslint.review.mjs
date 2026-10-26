// Local self-check mirroring Obsidian's automated review (see memory/obsidian-review-standards.md).
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      obsidianmd,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...obsidianmd.configs.recommended.rules,
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      'no-useless-escape': 'warn',
    },
  },
);
