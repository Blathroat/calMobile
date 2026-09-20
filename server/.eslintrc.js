module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script'
  },
  rules: {
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    eqeqeq: 'error',
    semi: ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true }],
    // 两空格：本仓库后端（含既有 config/ 与 demo-* 文件）一直用两空格，
    // 前端 assets/web/js 用四空格，两边各自保持一致即可。
    indent: ['error', 2, { SwitchCase: 1 }],
    'no-console': 'off',
    'no-trailing-spaces': 'off'
  }
};
