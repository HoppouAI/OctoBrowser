/**
 * Copilot Service - Handles GitHub Copilot SDK integration
 * Uses dynamic imports for ES Module compatibility with CommonJS
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

// Find system Node.js (not Electron's bundled one) for the Copilot CLI subprocess
function getSystemNodePath(): string | null {
    try {
        const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
        const result = execFileSync(cmd, ['node'], { encoding: 'utf8', windowsHide: true });
        const paths = result.trim().split(/\r?\n/);
        for (const p of paths) {
            const trimmed = p.trim();
            if (trimmed && !trimmed.toLowerCase().includes('electron') && fs.existsSync(trimmed)) {
                return trimmed;
            }
        }
    } catch { /* system node not found */ }
    return null;
}

interface LocalModelInfo {
    id: string;
    name?: string;
}

// Tool action callbacks - will be set by main process
export interface BrowserToolCallbacks {
    navigateToUrl: (url: string, target?: 'current_tab' | 'new_tab') => Promise<void>;
    searchWeb: (query: string) => Promise<{ url: string }>;
    searchYouTube: (query: string) => Promise<{ url: string }>;
    getPageContent: () => Promise<{ title: string; url: string; content: string } | null>;
    getOpenTabs: () => Promise<Array<{ id: string; title: string; url: string }>>;
    closeTab: (tabId: string) => Promise<boolean>;
    clickElement: (selector: string) => Promise<boolean>;
    clickElementByText: (text: string) => Promise<boolean>;
    typeText: (text: string, selector?: string) => Promise<boolean>;
    findInPage: (text: string) => Promise<{ count: number }>;
    scrollPage: (direction: 'up' | 'down' | 'top' | 'bottom') => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    takeScreenshot: () => Promise<string | null>;
    wait: (duration: number, selector?: string) => Promise<boolean>;
    askUser?: (questions: any[]) => Promise<any>;
    getClickableLinks: () => Promise<Array<{ text: string; url: string; type: string }>>;
    clickByIndex: (index: number) => Promise<boolean>;
    searchInPage: (text: string) => Promise<{ found: boolean; matches: string[] }>;
    getVisualDescription: () => Promise<string>;
    saveScreenshotToFile: () => Promise<string | null>;
    pressKey: (key: string) => Promise<boolean>;
}

// Wrap tool handlers with timeout
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error('Tool execution timed out')), timeoutMs)
        )
    ]);
}

// Store SDK module references
let CopilotClientClass: any = null;
let defineToolFn: any = null;
let approveAllFn: any = null;
let sdkLoaded: boolean = false;

// Helper to load the SDK dynamically using eval to bypass TypeScript's static analysis
async function loadSDK(): Promise<boolean> {
    if (sdkLoaded) return true;
    
    try {
        // Use Function constructor to create a truly dynamic import that bypasses static analysis
        const importFn = new Function('specifier', 'return import(specifier)');
        const sdk = await importFn('@github/copilot-sdk');
        CopilotClientClass = sdk.CopilotClient;
        defineToolFn = sdk.defineTool;
        approveAllFn = sdk.approveAll;
        sdkLoaded = true;
        return true;
    } catch (error) {
        console.error('Failed to load Copilot SDK:', error);
        return false;
    }
}

export class CopilotService {
    private client: any = null;
    private session: any = null;
    private currentModel: string = 'gpt-4.1';
    private isInitialized: boolean = false;
    private conversationHistory: Array<{ role: string; content: string }> = [];
    private toolCallbacks: BrowserToolCallbacks | null = null;
    private onToolResult: ((toolName: string, result: string) => void) | null = null;
    private sessionErrorCount: number = 0;
    private readonly MAX_SESSION_ERRORS = 3;
    private activeStreamCleanup: (() => void) | null = null;

    async initialize(): Promise<boolean> {
        try {
            if (this.isInitialized && this.client) {
                return true;
            }

            // Load SDK dynamically
            const loaded = await loadSDK();
            if (!loaded || !CopilotClientClass) {
                console.error('Copilot SDK not available');
                return false;
            }

            // Resolve the Copilot CLI path from the SDK's dependencies
            const sdkEntry = require.resolve('@github/copilot-sdk');
            const copilotCliPath = path.join(path.dirname(sdkEntry), '..', '..', '..', 'copilot', 'index.js');

            // The Copilot CLI requires Node.js 22.5+ (for node:sqlite).
            // In Electron, process.execPath points to the Electron binary (Node 18),
            // so we must use the system Node.js to spawn the CLI subprocess.
            const systemNode = getSystemNodePath();
            const clientOptions: any = { logLevel: 'error' };

            if (systemNode) {
                // Use system node as the executable, pass CLI script as an arg
                clientOptions.cliPath = systemNode;
                clientOptions.cliArgs = [copilotCliPath];
            } else {
                // Fallback: use the CLI path directly (may fail if Electron's Node is too old)
                clientOptions.cliPath = copilotCliPath;
            }

            this.client = new CopilotClientClass(clientOptions);

            await this.client.start();
            this.isInitialized = true;
            
            // Create initial session
            await this.createSession();
            
            return true;
        } catch (error) {
            console.error('Failed to initialize Copilot:', error);
            return false;
        }
    }

    setToolCallbacks(callbacks: BrowserToolCallbacks): void {
        this.toolCallbacks = callbacks;
    }

    private async createSession(model?: string): Promise<void> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }

        // Destroy existing session
        if (this.session) {
            try {
                await this.session.disconnect();
            } catch (e) {
                // Ignore cleanup errors
            }
            this.session = null;
        }

        // Reset error count on new session creation
        this.sessionErrorCount = 0;

        const tools = this.createBrowserTools();

        this.session = await this.client.createSession({
            model: model || this.currentModel,
            streaming: true,
            tools,
            onPermissionRequest: approveAllFn,
            systemMessage: {
                mode: 'replace',
                content: `
<context>
You are OctoBrowser's AI assistant, powered by GitHub Copilot.
You're a helpful AI integrated into a web browser with full browser automation capabilities.
</context>

<capabilities>
- Navigate to any website
- Search the web via Google or search directly on YouTube
- Read and summarize web page content
- Click buttons and links on pages
- Type text into search boxes and forms
- Scroll pages up/down
- Find text on pages
- Take screenshots - the image is saved to disk and you can use the built-in view tool to see page contents visually
- Navigate back/forward in history
- Wait for page content or specific elements to load
- Ask clarifying questions to the user rather than ending the turn.
</capabilities>

<instructions>
- Be concise and direct.
- IMPORTANT: You are a browser automation agent. DO NOT use any tools other than the provided \`browser_*\` tools and the built-in \`view\` tool for viewing screenshots.
- **VISUAL AWARENESS**: Use \`browser_take_screenshot\` to capture the page. It saves the image to a file and returns the path. Then use the built-in \`view\` tool with that path to see what's on the page visually.
  - Whether a video is playing, paused, buffering, or showing an ad
  - All visible buttons and their labels
  - Video titles, channels, and URLs on YouTube
  - Form inputs and their current values
  - Headings and key text content
  - Alerts and notices
- When users ask about the current page state (e.g., "is the video playing?", "what do you see?"), use \`browser_take_screenshot\`.
- **CRITICAL**: Before taking a screenshot or interacting with a page after navigation, YOU MUST USE \`browser_wait\` (for at least 2000ms or waiting for a selector) to ensure the content has loaded. Do not assume immediate load.
- **CRITICAL**: When you need to ask the user a question, clarify intent, or get a decision (e.g., "Which video should I play?"), YOU MUST use the \`browser_ask_questions\` tool. DO NOT ask questions in your final text response. Use the tool to present options or get input.
- **YOUTUBE WORKFLOW**: When searching for videos on YouTube:
  1. Use \`browser_search_youtube\` to search
  2. Use \`browser_wait\` (2000ms) for results to load
  3. Use \`browser_take_screenshot\` or \`browser_get_links\` to see the video results with their URLs
  4. If user requested a specific video, find the matching one from the results
  5. If multiple matches exist, use \`browser_ask_questions\` to let user choose
  6. Use \`browser_click_video\` with the video number to click it
- For general web searches, use browser_search_web.
- For YouTube searches, use browser_search_youtube.
- To open URLs, use browser_open_url.
- To interact with page elements, use browser_click_element (if you know the selector) or browser_click_text (if you know the text).
- If a page has infinite scroll or likely more content, use browser_scroll_page to investigate.
- If a tool fails, explain why and try a different approach (e.g. searching instead of direct navigation).
- You can "play" media by navigating to the video page. Do not state you cannot play videos if you can navigate to them.
- Prefer reusing the current tab for navigation actions unless explicitly asked to open a new tab. Avoid opening excessive tabs.
If you've opened multiple tabs trying to find something please close the old unused tabs when finished using browser_close_tabs. Do not just leave tabs open for no reason.
- Do not play random youtube Videos only play the requested video or ask the user to select from the top results using the ask questions tool.
</instructions>

<best_practices>
- **Efficiency**: Don't just stare at a page; act on it. If you need to find something, search or scroll.
- **Verification**: After navigating, check the page content to ensure you are where you expect to be.
- **Selectors**: Use robust CSS selectors for clicks (e.g., IDs, unique classes, or attribute selectors).
- **Navigation**: Prefer direct navigation if the URL is known or obvious; otherwise search.
- **Error Handling**: If a tool fails, provide a clear explanation and consider alternative actions.
- **User Intent**: Always align your actions with the user's original intent, clarifying when necessary.
- **Multiple steps**: If a user tells you to do a long task, complete it as requested.
- **YouTube Videos**: YouTube videos automatically play when opened, theres no need to click play.
- **Tab management**: If you have more than 2 tabs open, close any that are not needed using browser_close_tabs to keep your workspace tidy. Make sure to not continue opening new tabs without closing old ones. and dont close the active tab unless instructed. and dont close tabs opened by the user. Make sure after completing a task to list open tabs using browser_get_open_tabs and close any unneeded ones.
</best_practices>

<never_do>
- Never use any tools other than browser_* tools and the view tool. You ARE a BROWSER AUTOMATION AGENT.
- Never use shell, edit_file, read_file (except view for screenshots), or any file manipulation tools.
</never_do>
`,
            },
        });

        this.currentModel = model || this.currentModel;
    }

    private createBrowserTools(): any[] {
        if (!defineToolFn) {
            return [];
        }
        
        const callbacks = this.toolCallbacks;

        // Helper to report results to the stream
        const reportResult = (name: string, result: string) => {
            if (this.onToolResult) {
                this.onToolResult(name, result);
            }
        };
        
        return [
            defineToolFn('browser_get_page_content', {
                description: 'Get the content/text of the currently active web page in the browser. Use this when the user asks about the page they are viewing.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const content = await withTimeout(callbacks.getPageContent(), 10000);
                        let result = 'No page content available';
                        if (content) {
                            // Ensure strict limit on content size to prevent context overflow (400 errors)
                            const safeContent = content.content.substring(0, 4000);
                            result = `Page: ${content.title}\nURL: ${content.url}\n\nContent:\n${safeContent}`;
                        }
                        reportResult('browser_get_page_content', result.substring(0, 100) + (result.length > 100 ? '...' : '')); 
                        return result;
                    } catch (error: any) {
                        const msg = `Failed to get page content: ${error.message || 'unknown error'}`;
                        reportResult('browser_get_page_content', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_search_web', {
                description: 'Search the web using Google. Use this for general web searches.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query to look up',
                        },
                    },
                    required: ['query'],
                },
                handler: async (args: { query: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const result = await withTimeout(callbacks.searchWeb(args.query), 10000);
                        const msg = `Searched for "${args.query}"`;
                        reportResult('browser_search_web', msg);
                        return `${msg} - opened ${result.url}`;
                    } catch (error: any) {
                        const msg = `Failed to search: ${error.message || 'unknown error'}`;
                        reportResult('browser_search_web', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_search_youtube', {
                description: 'Search for videos on YouTube. Use this when the user wants to search for videos or content on YouTube specifically.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query to look up on YouTube',
                        },
                    },
                    required: ['query'],
                },
                handler: async (args: { query: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const result = await withTimeout(callbacks.searchYouTube(args.query), 10000);
                        const msg = `Searched YouTube for "${args.query}"`;
                        reportResult('browser_search_youtube', msg);
                        return `${msg} - opened ${result.url}`;
                    } catch (error: any) {
                        const msg = `Failed to search YouTube: ${error.message || 'unknown error'}`;
                        reportResult('browser_search_youtube', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_open_url', {
                description: 'Open a URL in the browser. Can open in the current tab or a new tab.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to open',
                        },
                        target: {
                            type: 'string',
                            description: 'Where to open: "current_tab" (default) or "new_tab"',
                            enum: ['current_tab', 'new_tab'],
                        },
                    },
                    required: ['url'],
                },
                handler: async (args: { url: string; target?: 'current_tab' | 'new_tab' }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const target = args.target || 'current_tab';
                        await withTimeout(callbacks.navigateToUrl(args.url, target), 10000);
                        const msg = `Opened ${args.url} in ${target === 'new_tab' ? 'new tab' : 'current tab'}`;
                        reportResult('browser_open_url', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to open URL: ${error.message || 'unknown error'}`;
                        reportResult('browser_open_url', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_get_open_tabs', {
                description: 'Get a list of all currently open tabs with their IDs, titles, and URLs.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const tabs = await withTimeout(callbacks.getOpenTabs(), 5000);
                        if (tabs.length === 0) {
                            const msg = 'No tabs are currently open.';
                            reportResult('browser_get_open_tabs', msg);
                            return msg;
                        }
                        
                        const tabsList = tabs.map(t => `- [${t.id}] ${t.title} (${t.url})`).join('\n');
                        const msg = `Currently open tabs:\n${tabsList}`;
                        
                        // Short summary for the UI
                        reportResult('browser_get_open_tabs', `Found ${tabs.length} open tabs`);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to get open tabs: ${error.message || 'unknown error'}`;
                        reportResult('browser_get_open_tabs', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_close_tabs', {
                description: 'Close one or more browser tabs by their IDs.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        tabIds: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Array of tab IDs to close (get these from browser_get_open_tabs)',
                        },
                    },
                    required: ['tabIds'],
                },
                handler: async (args: { tabIds: string[] }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const results = [];
                        for (const id of args.tabIds) {
                            const success = await withTimeout(callbacks.closeTab(id), 5000);
                            results.push(success ? `Closed ${id}` : `Failed ${id}`);
                        }
                        const msg = `Closed ${results.length} tabs: ${results.join(', ')}`;
                        reportResult('browser_close_tabs', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to close tabs: ${error.message || 'unknown error'}`;
                        reportResult('browser_close_tabs', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_click_element', {
                description: 'Click on an element on the page using a CSS selector. Use this when you know the specific DOM structure or ID.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        selector: {
                            type: 'string',
                            description: 'CSS selector for the element to click',
                        },
                    },
                    required: ['selector'],
                },
                handler: async (args: { selector: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const success = await withTimeout(callbacks.clickElement(args.selector), 10000);
                        const msg = success ? `Clicked: ${args.selector}` : `Element not found: ${args.selector}`;
                        reportResult('browser_click_element', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to click: ${error.message || 'unknown error'}`;
                        reportResult('browser_click_element', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_click_text', {
                description: 'Click on an element containing specific text. useful when you see text on the page but don\'t know the CSS selector.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text displayed on the element you want to click (button label, link text, etc.)',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args: { text: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const success = await withTimeout(callbacks.clickElementByText(args.text), 10000);
                        const msg = success ? `Clicked element with text: "${args.text}"` : `No element found containing text: "${args.text}"`;
                        reportResult('browser_click_text', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to click by text: ${error.message || 'unknown error'}`;
                        reportResult('browser_click_text', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_type_text', {
                description: 'Type text into an input field. Optionally specify a CSS selector to focus first.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text to type',
                        },
                        selector: {
                            type: 'string',
                            description: 'Optional CSS selector for the input field',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args: { text: string; selector?: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const success = await withTimeout(callbacks.typeText(args.text, args.selector), 10000);
                        const msg = success ? `Typed: "${args.text}"` : 'No input field found';
                        reportResult('browser_type_text', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to type: ${error.message || 'unknown error'}`;
                        reportResult('browser_type_text', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_press_key', {
                description: 'Press a specific key or key combination (e.g., "Enter", "Tab", "ArrowDown", "Control+C"). Use this for navigation, shortcuts, or submitting forms without a submit button.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        key: {
                            type: 'string',
                            description: 'The key or combination to press (e.g. "Enter", "a", "Control+a")',
                        },
                    },
                    required: ['key'],
                },
                handler: async (args: { key: string }) => {
                    if (!callbacks || !callbacks.pressKey) return 'Press key capability not available';
                    try {
                        const success = await withTimeout(callbacks.pressKey(args.key), 5000);
                        const msg = success ? `Pressed key: "${args.key}"` : `Failed to press key: "${args.key}"`;
                        reportResult('browser_press_key', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to press key: ${error.message || 'unknown error'}`;
                        reportResult('browser_press_key', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_find_in_page', {
                description: 'Find and highlight text on the current page.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text to find',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args: { text: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const result = await withTimeout(callbacks.findInPage(args.text), 5000);
                        const msg = result.count > 0 
                            ? `Found ${result.count} match(es) for "${args.text}"` 
                            : `No matches for "${args.text}"`;
                        reportResult('browser_find_in_page', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to find: ${error.message || 'unknown error'}`;
                        reportResult('browser_find_in_page', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_scroll_page', {
                description: 'Scroll the page up, down, to top, or to bottom.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            description: 'Direction: "up", "down", "top", or "bottom"',
                            enum: ['up', 'down', 'top', 'bottom'],
                        },
                    },
                    required: ['direction'],
                },
                handler: async (args: { direction: 'up' | 'down' | 'top' | 'bottom' }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        await withTimeout(callbacks.scrollPage(args.direction), 5000);
                        const msg = `Scrolled ${args.direction}`;
                        reportResult('browser_scroll_page', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to scroll: ${error.message || 'unknown error'}`;
                        reportResult('browser_scroll_page', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_go_back', {
                description: 'Navigate back in browser history.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        await withTimeout(callbacks.goBack(), 5000);
                        const msg = 'Went back';
                        reportResult('browser_go_back', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to go back: ${error.message || 'unknown error'}`;
                        reportResult('browser_go_back', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_go_forward', {
                description: 'Navigate forward in browser history.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        await withTimeout(callbacks.goForward(), 5000);
                        const msg = 'Went forward';
                        reportResult('browser_go_forward', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to go forward: ${error.message || 'unknown error'}`;
                        reportResult('browser_go_forward', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_take_screenshot', {
                description: 'Take a screenshot of the current page. Saves the image to disk and returns the file path. Use the built-in view tool with the returned path to see page contents.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        // Capture screenshot for user display
                        const dataUrl = await withTimeout(callbacks.takeScreenshot(), 10000);
                        if (dataUrl) {
                            reportResult('browser_take_screenshot', dataUrl);
                        }
                        
                        // Save to file for view tool access
                        let filePath: string | null = null;
                        if (callbacks.saveScreenshotToFile) {
                            filePath = await callbacks.saveScreenshotToFile();
                        }
                        
                        if (filePath) {
                            return `Screenshot saved to: ${filePath}\nUse the view tool to see the screenshot contents.`;
                        }
                        
                        // Fallback to text description if save failed
                        const visualDescription = await withTimeout(callbacks.getVisualDescription(), 10000);
                        return visualDescription;
                    } catch (error: any) {
                        const msg = `Failed to screenshot: ${error.message || 'unknown error'}`;
                        reportResult('browser_take_screenshot', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_wait', {
                description: 'Wait for a specific duration or for an element to appear on the page.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        duration: {
                            type: 'number',
                            description: 'Time to wait in milliseconds (default: 1000)',
                        },
                        selector: {
                            type: 'string',
                            description: 'Optional CSS selector to wait for',
                        },
                    },
                },
                handler: async (args: { duration?: number; selector?: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const duration = args.duration || 1000;
                        await withTimeout(callbacks.wait(duration, args.selector), duration + 5000); // Add buffer to timeout
                        const msg = args.selector 
                            ? `Waited for "${args.selector}"` 
                            : `Waited ${duration}ms`;
                        reportResult('browser_wait', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to wait: ${error.message || 'unknown error'}`;
                        reportResult('browser_wait', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_report_intent', {
                description: 'Report the intent of the current action to the user.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        intent: {
                            type: 'string',
                            description: 'The description of the action being performed',
                        },
                    },
                    required: ['intent'],
                },
                handler: async (args: { intent: string }) => {
                    // This is a no-op tool mainly for the model to "speak" its plan if it wants to.
                    const msg = `Intent reported: ${args.intent}`;
                    // We don't necessarily need to show this in the UI as a separate "tool used" block if we don't want to,
                    // but for debugging or completeness we can report it.
                    reportResult('browser_report_intent', msg);
                    return msg;
                },
            }),
            defineToolFn('browser_ask_questions', {
                description: 'Ask the user questions to clarify intent, validate assumptions, or choose between implementation approaches. Use this when you are stuck or need user input to proceed.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        questions: {
                            description: 'Array of 1-4 questions to ask the user',
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    header: {
                                        description: 'A short label (max 12 chars) displayed as a quick pick header',
                                        type: 'string'
                                    },
                                    question: {
                                        description: 'The complete question text to display',
                                        type: 'string'
                                    },
                                    multiSelect: {
                                        description: 'Allow multiple selections',
                                        type: 'boolean'
                                    },
                                    options: {
                                        description: '0-6 options for the user to choose from. If empty or omitted, shows a free text input instead.',
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                label: { description: 'Option label text', type: 'string' },
                                                description: { description: 'Optional description for the option', type: 'string' },
                                                recommended: { description: 'Mark this option as recommended', type: 'boolean' }
                                            },
                                            required: ['label']
                                        }
                                    }
                                },
                                required: ['header', 'question']
                            }
                        }
                    },
                    required: ['questions'],
                },
                handler: async (args: { questions: any[] }) => {
                    if (!callbacks || !callbacks.askUser) return 'Ask user capability not available (ensure main process implements askUser callback)';
                    try {
                        // User interaction might take a while, so we use a very long timeout (e.g. 5 minutes)
                        const answers = await withTimeout(callbacks.askUser(args.questions), 300000);
                        const result = JSON.stringify(answers);
                        
                        let displayResult = 'User answered questions:\n';
                        if (Array.isArray(answers)) {
                            displayResult += answers.map((a: any) => `**${a.question}**: ${Array.isArray(a.answer) ? a.answer.join(', ') : a.answer}`).join('\n\n');
                        } else {
                            displayResult += 'Action Completed.';
                        }
                        
                        reportResult('browser_ask_questions', displayResult);
                        return result;
                    } catch (error: any) {
                        const msg = `Failed to get answers: ${error.message || 'unknown error'}`;
                        reportResult('browser_ask_questions', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_get_links', {
                description: 'Get all clickable links and buttons on the current page. Returns an array of items with text, URL, and type. Essential for finding YouTube video links or navigation options.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks || !callbacks.getClickableLinks) return 'Get links capability not available';
                    try {
                        const links = await withTimeout(callbacks.getClickableLinks(), 10000);
                        if (links.length === 0) {
                            const msg = 'No clickable links found on page';
                            reportResult('browser_get_links', msg);
                            return msg;
                        }
                        
                        // Format links for easy reading
                        const formatted = links.map((link: any, i: number) => {
                            if (link.type === 'youtube-video') {
                                return `[${link.index || i+1}] VIDEO: "${link.text}" → ${link.url}`;
                            } else if (link.type === 'button') {
                                return `[BTN] "${link.text}"`;
                            } else {
                                return `[LINK] "${link.text}" → ${link.url}`;
                            }
                        }).join('\n');
                        
                        const msg = `Found ${links.length} clickable items:\n${formatted}`;
                        reportResult('browser_get_links', `Found ${links.length} links`);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to get links: ${error.message || 'unknown error'}`;
                        reportResult('browser_get_links', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_click_video', {
                description: 'Click on a YouTube video result by its number/index. Use after browser_get_links to click the correct video.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        index: {
                            type: 'number',
                            description: 'The video number to click (1 for first video, 2 for second, etc.)',
                        },
                    },
                    required: ['index'],
                },
                handler: async (args: { index: number }) => {
                    if (!callbacks || !callbacks.clickByIndex) return 'Click by index capability not available';
                    try {
                        const success = await withTimeout(callbacks.clickByIndex(args.index), 10000);
                        const msg = success 
                            ? `Clicked video #${args.index}` 
                            : `Could not find video #${args.index}`;
                        reportResult('browser_click_video', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to click video: ${error.message || 'unknown error'}`;
                        reportResult('browser_click_video', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_search_text', {
                description: 'Search for text on the page (case-insensitive). Returns matching text snippets. Use this to verify content exists before clicking.',
                skipPermission: true,
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text to search for on the page',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args: { text: string }) => {
                    if (!callbacks || !callbacks.searchInPage) return 'Search capability not available';
                    try {
                        const result = await withTimeout(callbacks.searchInPage(args.text), 5000);
                        let msg: string;
                        if (result.found) {
                            msg = `Found "${args.text}" on page:\n${result.matches.map((m: string) => `• ${m}`).join('\n')}`;
                        } else {
                            msg = `"${args.text}" not found on page`;
                        }
                        reportResult('browser_search_text', result.found ? `Found ${result.matches?.length || 0} matches` : 'No matches');
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to search: ${error.message || 'unknown error'}`;
                        reportResult('browser_search_text', msg);
                        return msg;
                    }
                },
            }),
        ];
    }

    async sendMessage(message: string, model?: string): Promise<string> {
        if (!this.session) {
            throw new Error('Session not created');
        }

        // Recreate session if we've had too many errors
        if (this.sessionErrorCount >= this.MAX_SESSION_ERRORS) {
            console.log('Recreating session due to previous errors...');
            await this.createSession(model || this.currentModel);
        }

        // Switch model if needed
        if (model && model !== this.currentModel) {
            await this.createSession(model);
        }

        this.conversationHistory.push({ role: 'user', content: message });

        try {
            const response = await this.session.sendAndWait({ prompt: message });
            const content = response?.data?.content || 'No response received';
            
            this.conversationHistory.push({ role: 'assistant', content });
            this.sessionErrorCount = 0; // Reset on success
            
            return content;
        } catch (error) {
            this.sessionErrorCount++;
            console.error('Error sending message:', error);
            throw error;
        }
    }

    async streamMessage(
        message: string, 
        model: string | undefined, 
        onEvent: (event: { type: string; data?: any }) => void
    ): Promise<string> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }

        // Recreate session if we've had too many errors
        if (this.sessionErrorCount >= this.MAX_SESSION_ERRORS) {
            console.log('Recreating session due to previous errors...');
            await this.createSession(model || this.currentModel);
        }

        // Switch model if needed
        if (model && model !== this.currentModel) {
            await this.createSession(model);
        }

        if (!this.session) {
            throw new Error('Session not created');
        }

        // Ensure any previous stream is cleaned up to prevent duplicate listeners
        if (this.activeStreamCleanup) {
            console.log('Cleaning up previous active stream before starting new one');
            this.activeStreamCleanup();
        }

        this.conversationHistory.push({ role: 'user', content: message });

        return new Promise((resolve, reject) => {
            let fullContent = '';
            let unsubscribe: (() => void) | null = null;
            
            // Track state to avoid duplicate content on mixed events
            let currentToolId: string | null = null;
            let processedToolIds = new Set<string>();
            let activeToolCount = 0; // Track number of tools currently running
            
            // Timeout for detecting stuck sessions (only when no tools running)
            let idleTimeout: NodeJS.Timeout | null = null;
            const IDLE_TIMEOUT_MS = 60000; // 60 seconds max for a response
            
            const resetIdleTimeout = () => {
                if (idleTimeout) clearTimeout(idleTimeout);
                // Only set timeout if no tools are actively running
                if (activeToolCount > 0) return;
                
                idleTimeout = setTimeout(() => {
                    // Double-check no tools running before timing out
                    if (activeToolCount > 0) return;
                    
                    console.warn('Session appears stuck, timing out...');
                    cleanup();
                    // Don't reject, just resolve with what we have
                    if (fullContent) {
                        this.conversationHistory.push({ role: 'assistant', content: fullContent });
                    }
                    resolve(fullContent || 'Response timed out');
                }, IDLE_TIMEOUT_MS);
            };
            
            const pauseIdleTimeout = () => {
                if (idleTimeout) {
                    clearTimeout(idleTimeout);
                    idleTimeout = null;
                }
            };
            
            const cleanup = () => {
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                if (idleTimeout) {
                    clearTimeout(idleTimeout);
                    idleTimeout = null;
                }
                this.onToolResult = null;
                this.activeStreamCleanup = null;
            };

            // Register global cleanup for abort/new stream
            this.activeStreamCleanup = () => {
                cleanup();
                // Resolve with partial content if aborted/interrupted
                resolve(fullContent);
            };

            // Set up tool result listener to capture exact output from handlers
            this.onToolResult = (toolName: string, result: string) => {
                resetIdleTimeout(); // Activity detected
                if (currentToolId && !processedToolIds.has(currentToolId)) {
                    processedToolIds.add(currentToolId);
                    onEvent({ 
                        type: 'tool_end', 
                        data: { id: currentToolId, result: result } 
                    });
                }
            };

            const handleEvent = (event: any) => {
                console.log('Stream event:', event.type);
                resetIdleTimeout(); // Activity detected
                
                if (event.type === 'assistant.message_delta' || event.type === 'assistant.streaming_delta') {
                    const delta = (event.data as { deltaContent?: string }).deltaContent || '';
                    if (delta) {
                        fullContent += delta;
                        onEvent({ type: 'content', data: delta });
                    }
                } else if (event.type === 'assistant.reasoning_delta') {
                    const delta = (event.data as { deltaContent?: string }).deltaContent || '';
                    if (delta) {
                        onEvent({ type: 'thinking_delta', data: delta });
                    }
                } else if (event.type === 'tool.execution_start') {
                    // Tool is being executed - pause idle timeout
                    activeToolCount++;
                    pauseIdleTimeout();
                    
                    const possibleName = (event.data as { toolName?: string; name?: string }).toolName || 
                                         (event.data as { toolName?: string; name?: string }).name;
                    const toolName = possibleName || 'browser tool';
                    
                    const toolId = (event.data as { id?: string }).id || Date.now().toString();
                    currentToolId = toolId;
                    
                    console.log(`Tool starting: ${toolName} (ID: ${toolId})`);
                    
                    onEvent({ 
                        type: 'tool_start', 
                        data: { id: toolId, name: toolName } 
                    });
                } else if (event.type === 'tool.execution_complete' || event.type === 'tool.execution_end') {
                    // Tool finished - decrement counter and possibly resume timeout
                    activeToolCount = Math.max(0, activeToolCount - 1);
                    
                    const eventId = (event.data as { id?: string }).id;
                    const toolId = eventId || currentToolId;
                    
                    if (toolId && !processedToolIds.has(toolId)) {
                        console.log(`Tool completed: ID ${toolId}`);
                        processedToolIds.add(toolId);
                        
                        onEvent({ 
                            type: 'tool_end', 
                            data: { id: toolId } 
                        });
                        if (toolId === currentToolId) {
                            currentToolId = null;
                        }
                    }
                    
                    // Resume idle timeout if no more tools running
                    if (activeToolCount === 0) {
                        resetIdleTimeout();
                    }
                } else if (event.type === 'assistant.turn_end') {
                    // Model finished a turn - could continue with tools or end
                    console.log('Assistant turn ended');
                } else if (event.type === 'session.idle') {
                    console.log('Session idle, completing');
                    cleanup();
                    // Reset error count on successful completion
                    this.sessionErrorCount = 0;
                    if (fullContent) {
                        this.conversationHistory.push({ role: 'assistant', content: fullContent });
                    }
                    resolve(fullContent);
                } else if (event.type === 'session.error') {
                    console.error('Session error event:', event.data);
                    this.sessionErrorCount++;
                    cleanup();
                    
                    const errorMsg = (event.data as { message?: string }).message || 'Session error';
                    
                    // If we have partial content, return it instead of rejecting
                    if (fullContent) {
                        console.log('Returning partial content after error');
                        this.conversationHistory.push({ role: 'assistant', content: fullContent });
                        resolve(fullContent);
                        
                        // Schedule session recreation for next message
                        this.scheduleSessionRecreation();
                    } else {
                        reject(new Error(errorMsg));
                        
                        // Schedule session recreation for next message
                        this.scheduleSessionRecreation();
                    }
                }
            };

            resetIdleTimeout();
            unsubscribe = this.session!.on(handleEvent);
            this.session!.send({ prompt: message }).catch((err: Error) => {
                cleanup();
                reject(err);
            });
        });
    }
    
    private async scheduleSessionRecreation(): Promise<void> {
        // Recreate session asynchronously to recover from errors
        console.log('Scheduling session recreation...');
        setTimeout(async () => {
            try {
                if (this.sessionErrorCount >= this.MAX_SESSION_ERRORS) {
                    console.log('Too many session errors, recreating session...');
                    await this.createSession(this.currentModel);
                    console.log('Session recreated successfully');
                }
            } catch (e) {
                console.error('Failed to recreate session:', e);
            }
        }, 100);
    }

    async getModels(): Promise<LocalModelInfo[]> {
        // Only allow these specific models
        const allowedModels = ['gpt-4.1', 'claude-haiku-4.5', 'gpt-5-mini'];
        const defaultModels = [
            { id: 'gpt-4.1', name: 'GPT-4.1 (0x)' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini (0x)' },
            { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5 (0.33x)' },
        ];
        
        if (!this.client) {
            return defaultModels;
        }

        try {
            const models = await this.client.listModels();
            const filtered = models
                .filter((m: any) => allowedModels.includes(m.id))
                .map((m: any) => {
                    const defaultInfo = defaultModels.find(dm => dm.id === m.id);
                    return {
                        id: m.id,
                        name: defaultInfo ? defaultInfo.name : (m.name || m.id),
                    };
                });
            
            // Return filtered models if any match, otherwise return defaults
            return filtered.length > 0 ? filtered : defaultModels;
        } catch (error) {
            console.error('Failed to get models:', error);
            return defaultModels;
        }
    }

    getConversationHistory(): Array<{ role: string; content: string }> {
        return [...this.conversationHistory];
    }

    clearHistory(): void {
        this.conversationHistory = [];
    }

    async resetSession(): Promise<void> {
        // Clear conversation history
        this.conversationHistory = [];
        
        // Destroy existing session and create a fresh one
        if (this.session) {
            try {
                await this.session.disconnect();
            } catch (e) {
                // Ignore session cleanup errors
            }
            this.session = null;
        }
        
        // Create a fresh session
        await this.createSession();
        console.log('Copilot session reset - context cleared');
    }

    async abort(): Promise<void> {
        // First cleanup any active stream listeners
        if (this.activeStreamCleanup) {
            console.log('Aborting active stream listener...');
            this.activeStreamCleanup();
        }

        if (this.session) {
            try {
                await this.session.abort();
                console.log('Session aborted');
            } catch (e) {
                console.error('Failed to abort session:', e);
            }
        }
    }

    async stop(): Promise<void> {
        try {
            if (this.session) {
                try {
                    await this.session.disconnect();
                } catch (e) {
                    // Ignore session cleanup errors
                }
                this.session = null;
            }
            if (this.client) {
                try {
                    await this.client.stop();
                } catch (e) {
                    // Ignore client cleanup errors
                }
                this.client = null;
            }
            this.isInitialized = false;
        } catch (error) {
            // Ignore cleanup errors
            console.log('Copilot service stopped');
        }
    }
}
