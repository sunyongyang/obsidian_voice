import tseslint from 'typescript-eslint';
import obsidian from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default tseslint.config({
  files: ['src/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    globals: { ...globals.browser, ...globals.node },
  },
  plugins: { '@typescript-eslint': tseslint.plugin, obsidianmd: obsidian },
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'error',
    'obsidianmd/prefer-window-timers': 'error',
    'obsidianmd/prefer-create-el': 'error',
    'obsidianmd/settings-tab/prefer-setting-definitions': 'error',
  },
});