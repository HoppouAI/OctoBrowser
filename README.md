# OctoBrowser

<p align="center">
  <img src="assets/github-copilot-icon.svg" alt="OctoBrowser Logo" width="128" height="128">
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
- **Multiple AI Models** - Choose from GPT-4.1, GPT-5-Mini, Claude Haiku 4.5, and more (can be enabled in the code)
- **GitHub-Themed Design** - Beautiful UI inspired by GitHub's design system
- **Dark/Light Mode** - Automatic theme switching with manual override
- **Tab Management** - Multi-tab browsing with keyboard shortcuts
- **Streaming Responses** - Real-time AI responses with streaming support

## Screenshots

### Light Mode
![Light Mode](assets/Screenshot%202026-01-23%20222438.png)

### Dark Mode
![Dark Mode](assets/Screenshot%202026-01-23%20222411.png)

### Settings
![Settings](assets/Screenshot%202026-01-23%20222525.png)

### Chat History
![Chat History](assets/Screenshot%202026-01-23%20222547.png)

## Prerequisites

1. **Node.js** (v18 or later)
2. **GitHub Copilot CLI** - Install from [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
  3. ~~**GitHub Copilot Subscription** - Required for API access~~
  A Copilot subscription is not required but you are limited to 50 chat requests.

## Installation

```bash
# Clone the repository
git clone https://github.com/HoppouAI/OctoBrowser.git
cd OctoBrowser

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
- Click the Hamburger menu icon in the toolbar to toggle the AI sidebar (or press ctrl+shift+i)
- Type your question in the chat input
- Click the book icon to include the current page content in your question
- Select different AI models from the dropdown

### Example Prompts
- "Summarize this page for me"
- "What are the key points in this article?"
- "Search for the latest news about AI"
- "Help me find documentation for React hooks"

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
| `Ctrl+Shift+I` | Toggle Copilot Sidebar |
| `Enter` | Navigate/Send Message |

## Configuration

Settings are automatically saved and include:
- Window size and position
- Selected AI model
- Theme preference
- Sidebar visibility

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
Edit: Changed this back to normal as we may keep the project open source and available to do Future updates!

## License

MIT License - See [LICENSE](LICENSE) for details.

## Credits

Built with ❤️ for the GitHub Copilot SDK Weekend Contest using Various Models in GitHub Copilot.
Models Used to build this:
- Gemini 3 Pro
- Raptor Mini
- Claude Opus 4.5
and some of our own brain...

## Known Issues
- Sometimes when clearing all chat historys, you may not be able to type a new prompt, click out of the app and then back in to fix it.
- It may sometimes click the wrong links but i believe this is due to the computer/browser use knowladge of the Models, It happens more with GPT 4.1 and GPT 5 Mini than it does with Claude Haiku 4.5
- When the model uses the screenshot tool it has to take the screenshot, cancel the current chat flow and send the image as a new prompt to continue as the Copilot SDK doesn't have a way to send images as tool responces as far as i could find, Meaning it WILL use a PREMIUM request each time a screenshot is taken, So i advise using the 0x models rather than the 0.33x one (Haiku 4.5) to save your premium requests. (maybe someone from GitHub can clarify if there is a way or update the SDK to allow this in the future?)

## Acknowledgements
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [Electron](https://www.electronjs.org/)
- [GitHub Primer Design](https://primer.style/)
- [Scroll Bar](https://codepen.io/DevSkyler/pen/QWqOdmp)
- [UBlock Origin Addon](https://github.com/gorhill/uBlock)
---

<p align="center">
  <sub>OctoBrowser is not affiliated with GitHub. GitHub and Copilot are trademarks of GitHub, Inc.</sub>
</p>
