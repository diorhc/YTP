module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-undef': 'off',
    eqeqeq: ['warn', 'always', { null: 'ignore' }],
    curly: ['warn', 'all'],
    'prefer-const': ['warn'],
    semi: ['warn', 'always'],
  },
};
