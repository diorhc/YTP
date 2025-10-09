# Contributing to YouTube Plus v2.0

Thank you for your interest in contributing to YouTube Plus! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Keep discussions professional

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- Git
- A code editor (VS Code recommended)

### Initial Setup

```powershell
# Clone the repository
git clone https://github.com/user/youtube-plus-modular.git
cd youtube-plus-modular

# Install dependencies
npm install

# Run tests to ensure everything works
npm test

# Start development with watch mode
npm run build:watch
```

## Development Workflow

### Project Structure

```
youtube-plus-modular/
├── src/              # Source modules
│   ├── utils.js      # Shared utilities (must be first)
│   ├── error-boundary.js  # Global error handler
│   ├── performance.js     # Performance monitoring
│   ├── main.js            # Main YouTube+ logic
│   └── *.js               # Feature modules
├── test/             # Unit tests
├── build.js          # Build system
├── build.order.json  # Module concatenation order
└── youtube.user.js   # Built userscript (generated)
```

### Creating a New Module

1. **Create the module file** in `src/`:

```javascript
/**
 * Module Name - Brief Description
 * @module ModuleName
 */
(function () {
  'use strict';

  // Your module code here
  
  // Use error boundaries for safety
  const myFunction = window.YouTubeErrorBoundary?.withErrorBoundary(
    () => {
      // Your code
    },
    'ModuleName'
  );

  // Initialize
  myFunction();
})();
```

2. **Add to build order** in `build.order.json`:

```json
[
  "utils.js",
  "error-boundary.js",
  "performance.js",
  "main.js",
  "your-module.js"
]
```

3. **Add JSDoc comments** for type safety:

```javascript
/**
 * Function description
 * @param {string} param1 - Parameter description
 * @param {number} param2 - Parameter description
 * @returns {boolean} Return value description
 */
const myFunction = (param1, param2) => {
  // Implementation
};
```

### Building

```powershell
# Standard build
npm run build

# Fast build (skip ESLint)
npm run build:fast

# Production build (minified)
npm run build:minify

# Watch mode (auto-rebuild on changes)
npm run build:watch
```

## Code Standards

### JavaScript Style

- **Modern ES6+**: Use arrow functions, const/let, template literals
- **Strict mode**: Always use `'use strict';`
- **IIFE pattern**: Wrap modules in `(function() { ... })();`
- **Error handling**: Use try-catch and error boundaries
- **Type safety**: Add JSDoc comments for TypeScript checking

### Naming Conventions

- **Variables**: camelCase (`myVariable`)
- **Constants**: UPPER_CASE (`MAX_RETRIES`)
- **Functions**: camelCase (`doSomething`)
- **Classes**: PascalCase (`MyClass`)
- **Private**: Prefix with `_` (`_privateFunction`)

### Code Quality

```powershell
# Lint your code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format

# Type check
npm run typecheck
```

### Best Practices

1. **Use shared utilities** from `window.YouTubeUtils`:
   ```javascript
   const debounced = window.YouTubeUtils.debounce(fn, 300);
   ```

2. **Wrap critical code** in error boundaries:
   ```javascript
   const safeFn = window.YouTubeErrorBoundary?.withErrorBoundary(
     myFunction,
     'ModuleName'
   );
   ```

3. **Track performance** for expensive operations:
   ```javascript
   window.YouTubePerformance?.mark('operation-start');
   // ... operation ...
   window.YouTubePerformance?.mark('operation-end');
   window.YouTubePerformance?.measure('operation', 'operation-start', 'operation-end');
   ```

4. **Clean up resources**:
   ```javascript
   const observer = new MutationObserver(callback);
   window.YouTubeUtils?.cleanupManager.registerObserver(observer);
   ```

## Testing Guidelines

### Writing Tests

1. **Create test file** in `test/` directory:

```javascript
describe('ModuleName', () => {
  describe('Feature', () => {
    test('should do something', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = myFunction(input);
      
      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

2. **Run tests**:

```powershell
# Run all tests
npm run test:unit

# Watch mode
npm run test:unit:watch

# Coverage report
npm run test:unit:coverage
```

### Test Coverage Goals

- **Critical modules**: 80%+ coverage
- **Utility functions**: 90%+ coverage
- **UI modules**: 60%+ coverage

## Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **build**: Build system changes
- **ci**: CI configuration changes
- **chore**: Maintenance tasks

### Examples

```bash
feat(comment): add bulk delete functionality

- Add checkboxes to comment elements
- Implement delete selected button
- Add settings integration

Closes #123
```

```bash
fix(error-boundary): handle async errors correctly

The error boundary was not catching async errors properly.
This commit adds async error handling wrapper.
```

### Pre-commit Hooks

The project uses Husky for pre-commit hooks:

- **Automatic linting** with ESLint
- **Automatic formatting** with Prettier
- **Type checking** with TypeScript

If you need to bypass hooks (not recommended):
```bash
git commit --no-verify
```

## Pull Request Process

### Before Submitting

1. **Update your branch**:
   ```bash
   git checkout main
   git pull origin main
   git checkout your-feature-branch
   git rebase main
   ```

2. **Run all checks**:
   ```powershell
   npm test
   ```

3. **Build successfully**:
   ```powershell
   npm run build
   ```

4. **Update documentation** if needed

### PR Checklist

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Build succeeds
- [ ] Commit messages follow guidelines

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Screenshots (if applicable)

## Related Issues
Closes #(issue number)
```

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Features**: Open a GitHub Issue with [Feature Request] tag
- **Security**: Email security@example.com

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in the userscript header

Thank you for contributing! 🎉
