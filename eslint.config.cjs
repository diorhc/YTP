// Minimal flat config compatible with ESLint v9+
module.exports = [
    {
        ignores: ['node_modules/**'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
        },
        plugins: {},
        rules: {
            // keep permissive; adjust if you want stricter linting
        },
    },
];
