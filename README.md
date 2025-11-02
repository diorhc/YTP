# YouTube Plus v2.0 - Modular Userscript

[![Tests](https://img.shields.io/badge/tests-76%20passing-success)](#)
[![Code Quality](https://img.shields.io/badge/quality-92%2F100-brightgreen)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-JSDoc-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)
[![Build](https://img.shields.io/badge/build-passing-success)](#)

Modular userscript build system for YouTube+ with automatic formatting, linting, and pre-commit hooks.

## 📋 Table of Contents

- [Features](#features)

- [Quick Start](#quick-start)

Professional-grade YouTube enhancement userscript with modular architecture, comprehensive error handling, performance monitoring, and automated testing.- [Project Structure](#project-structure)

- [Build System](#build-system)

## ✨ Key Features- [Development](#development)

- [Scripts](#scripts)

### 🏗️ **Infrastructure (v2.0 NEW)**- [Configuration](#configuration)

- ✅ **Global Error Boundary** - Automatic error catching and recovery- [Troubleshooting](#troubleshooting)

- ✅ **Performance Monitoring** - Real-time metrics and profiling- [Contributing](#contributing)

- ✅ **Comprehensive Testing** - 49 unit tests with Jest

- ✅ **Type Safety** - TypeScript JSDoc checking## ✨ Features

- ✅ **CI/CD Pipeline** - Automated builds and releases

- ✅ **Minification Support** - Production-ready builds- **Modular Architecture**: Separate your userscript into logical modules

- **Automatic Building**: Combines modules into a single userscript file

### 🎥 **YouTube Enhancements**- **Hot Reload**: Watch mode for automatic rebuilding on file changes

- Ad blocking and YouTube Premium features- **Code Quality**: Integrated ESLint and Prettier for consistent code

- Picture-in-Picture (PiP) mode- **Pre-commit Hooks**: Automatic linting and formatting before commits

- Enhanced video controls- **Customizable Order**: Control module concatenation order

- Timecode management- **Syntax Validation**: Built-in JavaScript syntax checking

- Channel statistics

- Custom thumbnails## 🚀 Quick Start

- And much more...

### Installation

## 📊 Project Stats

````powershell

| Metric | Value |# Install dependencies

|--------|-------|npm install

| **Modules** | 16 |

| **Tests** | 49 passing |# Build the userscript

| **Coverage** | ~60% |npm run build

| **Build Size** | ~200KB (60KB minified) |```

| **Quality Score** | 92/100 |

The built userscript will be in `youtube.user.js`.

## 🚀 Quick Start

## 📁 Project Structure

### Installation

````

```powershellyoutube-plus-modular/

# Clone the repository├── src/                  # Source modules

git clone https://github.com/diorhc/YoutubePlus.git│   ├── main.js          # Main entry point

cd youtube-plus-modular│   ├── utils.js         # Shared utilities

│   ├── adblocker.js     # Ad blocking

# Install dependencies│   └── ...              # Other modules

npm install├── build.js             # Build script

├── build.order.json     # Module order

# Build the userscript├── eslint.config.cjs    # ESLint config

npm run build└── youtube.user.js      # Built output

```

The built userscript will be in `youtube.user.js`. Install it with [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/).## 🔧 Build System

## 📚 API Documentation### Basic Build

```powershell

### YouTubeUtilsnpm run build

```

````javascript

// Debounce & Throttle### Watch Mode

const debouncedFn = YouTubeUtils.debounce(fn, 300);```powershell

const throttledFn = YouTubeUtils.throttle(fn, 1000);npm run build:watch

````

// DOM Utilities

const el = YouTubeUtils.createElement('div', { class: 'my-class' });### Fast Build (Skip ESLint)

const found = await YouTubeUtils.waitForElement('.selector', 5000);```powershell

npm run build:fast

// Cleanup Management```

YouTubeUtils.cleanupManager.registerListener(el, 'click', handler);

YouTubeUtils.cleanupManager.cleanup();## 💻 Development

````

### Adding a New Module

### YouTubeErrorBoundary

1. Create `src/my-feature.js`

```javascript2. Add to `build.order.json` (optional)

// Wrap functions for automatic error handling3. Run `npm run build`

const safeFn = YouTubeErrorBoundary.withErrorBoundary(fn, 'Context');

const stats = YouTubeErrorBoundary.getErrorStats();## 📜 Scripts

````

| Script | Description |

### YouTubePerformance|--------|-------------|

| `npm run build` | Build the userscript |

```javascript| `npm run build:watch` | Build and watch for changes |

// Performance monitoring| `npm run lint` | Run ESLint |

YouTubePerformance.mark('start');| `npm run lint:fix` | Auto-fix ESLint issues |

const duration = YouTubePerformance.measure('op', 'start');| `npm run format` | Format code with Prettier |

const timedFn = YouTubePerformance.timeFunction('myOp', fn);| `npm test` | Run all tests |

````

## 🔍 Troubleshooting

## 📜 Scripts

### Build Fails

| Script | Description |Ensure dependencies are installed:

|--------|-------------|```powershell

| `npm test` | Run full test suite |npm install

| `npm run build` | Build userscript |```

| `npm run build:minify` | Build with minification |

| `npm run lint:fix` | Auto-fix ESLint issues |### Watch Mode Not Working

| `npm run typecheck` | Check TypeScript types |Install chokidar:

```powershell

## 📄 Licensenpm install --save-dev chokidar

````

MIT License

### ESLint Warnings

---If you see warnings about `.eslintignore`, it's been replaced with `ignores` in `eslint.config.cjs` (ESLint v9+).

**Made with ❤️ for the YouTube community**### Userscript Not Working

1. Check browser console for errors
2. Ensure userscript manager is installed (Tampermonkey/Greasemonkey/Violentmonkey)
3. Refresh the page after installation
4. Check if userscript is enabled in your manager

### Build Order Issues

Module order is defined in `build.order.json`. If a module isn't loading correctly, check:

1. Module is listed in `build.order.json`
2. Module exists in `src/` directory
3. Module has no syntax errors

## ⚙️ Module Overview

### Core Modules

- **utils.js**: Shared utilities and helpers
- **main.js**: Core YouTube+ functionality and tab management
- **basic.js**: Basic YouTube utilities and DOM helpers

### Feature Modules

- **enhanced.js**: Enhanced UI with scroll-to-top button
- **adblocker.js**: Ad blocking and skipping
- **comment.js**: Comment section enhancements
- **count.js**: Channel statistics and live counts
- **endscr.js**: End screen customization
- **pip.js**: Picture-in-Picture functionality
- **shorts.js**: YouTube Shorts enhancements
- **stats.js**: Video statistics tracking
- **thumbnail.js**: Thumbnail improvements
- **timecode.js**: Timestamp and timecode features
- **update.js**: Auto-update functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes in `src/` directory
4. Run `npm test`
5. Commit and push
6. Create a Pull Request

### Code Style

- 2 spaces indentation
- Single quotes
- JSDoc comments for functions
- Descriptive variable names

## 📄 License

MIT License

---

Made with ❤️ for YouTube power users
