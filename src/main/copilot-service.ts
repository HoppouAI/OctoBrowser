/**
 * Copilot Service - Handles GitHub Copilot SDK integration
 * Uses dynamic imports for ES Module compatibility with CommonJS
 */

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
    typeText: (text: string, selector?: string) => Promise<boolean>;
    findInPage: (text: string) => Promise<{ count: number }>;
    scrollPage: (direction: 'up' | 'down' | 'top' | 'bottom') => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    takeScreenshot: () => Promise<string | null>;
    wait: (duration: number, selector?: string) => Promise<boolean>;
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

            this.client = new CopilotClientClass({
                logLevel: 'error',
            });

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
                await this.session.destroy();
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
            systemMessage: {
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
- Take screenshots
- Navigate back/forward in history
- Wait for page content or specific elements to load
</capabilities>

<instructions>
- Be concise and direct.
- When users ask about the current page, ALWAYS use browser_get_page_content first to understand the context.
- For general web searches, use browser_search_web.
- For YouTube searches, use browser_search_youtube.
- To interact with page elements, use browser_click_element or browser_type_text with precise selectors.
- If a page has infinite scroll or likely more content, use browser_scroll_page to investigate.
- If a tool fails, explain why and try a different approach (e.g. searching instead of direct navigation).
</instructions>

<best_practices>
- **Efficiency**: Don't just stare at a page; act on it. If you need to find something, search or scroll.
- **Verification**: After navigating, check the page content to ensure you are where you expect to be.
- **Selectors**: Use robust CSS selectors for clicks (e.g., IDs, unique classes, or attribute selectors).
- **Navigation**: Prefer direct navigation if the URL is known or obvious; otherwise search.
</best_practices>
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
            defineToolFn('browser_navigate_to_url', {
                description: 'Navigate the browser to a specific URL or website. Can optionally open in a new tab.',
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to navigate to',
                        },
                        target: {
                            type: 'string',
                            description: 'Where to open the URL: "current_tab" (default) or "new_tab"',
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
                        const msg = `Navigated to ${args.url} in ${target === 'new_tab' ? 'new tab' : 'current tab'}`;
                        reportResult('browser_navigate_to_url', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to navigate: ${error.message || 'unknown error'}`;
                        reportResult('browser_navigate_to_url', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_get_open_tabs', {
                description: 'Get a list of all currently open tabs with their IDs, titles, and URLs.',
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
            defineToolFn('browser_close_tab', {
                description: 'Close a specific browser tab by its ID.',
                parameters: {
                    type: 'object',
                    properties: {
                        tabId: {
                            type: 'string',
                            description: 'The ID of the tab to close (get this from browser_get_open_tabs)',
                        },
                    },
                    required: ['tabId'],
                },
                handler: async (args: { tabId: string }) => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const success = await withTimeout(callbacks.closeTab(args.tabId), 5000);
                        const msg = success 
                            ? `Closed tab ${args.tabId}` 
                            : `Failed to close tab ${args.tabId} (it might not exist)`;
                        reportResult('browser_close_tab', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to close tab: ${error.message || 'unknown error'}`;
                        reportResult('browser_close_tab', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_click_element', {
                description: 'Click on an element on the page using a CSS selector.',
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
            defineToolFn('browser_type_text', {
                description: 'Type text into an input field. Optionally specify a CSS selector to focus first.',
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
            defineToolFn('browser_find_in_page', {
                description: 'Find and highlight text on the current page.',
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
                description: 'Take a screenshot of the current page.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) return 'Browser tools not available';
                    try {
                        const dataUrl = await withTimeout(callbacks.takeScreenshot(), 10000);
                        const msg = dataUrl ? 'Screenshot captured' : 'Failed to capture';
                        reportResult('browser_take_screenshot', msg);
                        return msg;
                    } catch (error: any) {
                        const msg = `Failed to screenshot: ${error.message || 'unknown error'}`;
                        reportResult('browser_take_screenshot', msg);
                        return msg;
                    }
                },
            }),
            defineToolFn('browser_wait', {
                description: 'Wait for a specific duration or for an element to appear on the page.',
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
                
                if (event.type === 'assistant.message_delta') {
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

    async abort(): Promise<void> {
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
                    await this.session.destroy();
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
