# OctoBrowser

<p align="center">
  <img src="assets/icon.svg" alt="OctoBrowser Logo" width="128" height="128">
</p>

<h3 align="center">AI-Powered Web Browser with GitHub Copilot SDK</h3>

<p align="center">
  <strong>Built for the GitHub Copilot SDK Weekend Contest</strong>
</p>

---

## Overview

OctoBrowser is a modern, Chromium-based web browser with GitHub Copilot SDK built right in. It features an integrated AI sidebar that can help you browse the web, summarize pages, search for information, and answer questions about the content you're viewing.

## Features

- **Chromium-Based Browser** - Full web browsing capabilities powered by Electron
- **GitHub Copilot SDK Integration** - AI assistant built directly into the browser
- **Smart Page Summarization** - Ask Copilot to summarize any webpage you're viewing
- **Web Search Tools** - AI can search the web and navigate to pages for you
- **Multiple AI Models** - Choose from GPT-4.1, GPT-4o, GPT-5, Claude Sonnet, O1, and more
- **GitHub-Themed Design** - Beautiful UI inspired by GitHub's design system
- **Dark/Light Mode** - Automatic theme switching with manual override
- **Tab Management** - Multi-tab browsing with keyboard shortcuts
- **Streaming Responses** - Real-time AI responses with streaming support

## Screenshots

### Light Mode
```
+------------------------------------------------------------------+
|  OctoBrowser                           [ - ] [ □ ] [ × ]         |
+------------------------------------------------------------------+
| [Tab 1] [Tab 2] [+]                                              |
+------------------------------------------------------------------+
| [←] [→] [↻] | 🔍 https://github.com                    [🐙] [☀] |
+------------------------------------------------------------------+
|                                      |                           |
|                                      |  🐙 Copilot               |
|        Browser Content               |  [Model: GPT-4.1 ▼] [🗑] |
|                                      |                           |
|                                      |  Welcome to OctoBrowser   |
|                                      |                           |
|                                      |  [📄 Summarize] [🔍 Search]|
|                                      |                           |
|                                      |  [Ask Copilot...]    [→]  |
+------------------------------------------------------------------+
```

## Prerequisites

1. **Node.js** (v18 or later)
2. **GitHub Copilot CLI** - Install from [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
3. **GitHub Copilot Subscription** - Required for API access

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/octobrowser.git
cd octobrowser

# Install dependencies
npm install

# Build and run
npm start
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build only
npm run build

# Package for distribution
npm run package
```

## Usage

### Basic Browsing
- Enter URLs in the address bar or search terms to use Google
- Use keyboard shortcuts: `Ctrl+T` (new tab), `Ctrl+W` (close tab), `Ctrl+L` (focus URL)

### AI Assistant
- Click the Copilot icon in the toolbar to toggle the AI sidebar
- Type your question in the chat input
- Click the book icon to include the current page content in your question
- Select different AI models from the dropdown

### Example Prompts
- "Summarize this page for me"
- "What are the key points in this article?"
- "Search for the latest news about AI"
- "Explain what this code does" (on a GitHub page)
- "Help me find documentation for React hooks"

## Architecture

```
OctoBrowser
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts           # App entry point
│   │   ├── copilot-service.ts # Copilot SDK integration
│   │   ├── tab-manager.ts     # Browser tab management
│   │   └── settings-store.ts  # User preferences
│   ├── preload/        # Preload scripts for IPC
│   │   └── preload.ts
│   └── renderer/       # Browser UI
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── assets/             # Icons and images
└── dist/               # Compiled output
```

## Technologies

- **Electron** - Cross-platform desktop framework
- **Chromium** - Web rendering engine
- **GitHub Copilot SDK** - AI integration
- **TypeScript** - Type-safe development
- **CSS Custom Properties** - Theming system

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New Tab |
| `Ctrl+W` | Close Tab |
| `Ctrl+L` | Focus URL Bar |
| `Ctrl+R` | Reload Page |
| `Enter` | Navigate/Send Message |

## Configuration

Settings are automatically saved and include:
- Window size and position
- Selected AI model
- Theme preference
- Sidebar visibility

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Credits

Built with ❤️ for the GitHub Copilot SDK Weekend Contest

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [Electron](https://www.electronjs.org/)
- [GitHub Primer Design](https://primer.style/)

---

<p align="center">
  <sub>OctoBrowser is not affiliated with GitHub. GitHub and Copilot are trademarks of GitHub, Inc.</sub>
</p>
