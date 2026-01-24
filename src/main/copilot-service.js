/**
 * Copilot Service - Handles GitHub Copilot SDK integration
 * Uses dynamic imports for ES Module compatibility with CommonJS
 */
// Store SDK module references
let CopilotClientClass = null;
let defineToolFn = null;
let sdkLoaded = false;
// Helper to load the SDK dynamically using eval to bypass TypeScript's static analysis
async function loadSDK() {
    if (sdkLoaded)
        return true;
    try {
        // Use Function constructor to create a truly dynamic import that bypasses static analysis
        const importFn = new Function('specifier', 'return import(specifier)');
        const sdk = await importFn('@github/copilot-sdk');
        CopilotClientClass = sdk.CopilotClient;
        defineToolFn = sdk.defineTool;
        sdkLoaded = true;
        return true;
    }
    catch (error) {
        console.error('Failed to load Copilot SDK:', error);
        return false;
    }
}
export class CopilotService {
    client = null;
    session = null;
    currentModel = 'gpt-4.1';
    isInitialized = false;
    conversationHistory = [];
    toolCallbacks = null;
    async initialize() {
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
        }
        catch (error) {
            console.error('Failed to initialize Copilot:', error);
            return false;
        }
    }
    setToolCallbacks(callbacks) {
        this.toolCallbacks = callbacks;
    }
    async createSession(model) {
        if (!this.client) {
            throw new Error('Client not initialized');
        }
        // Destroy existing session
        if (this.session) {
            try {
                await this.session.destroy();
            }
            catch (e) {
                // Ignore cleanup errors
            }
        }
        const tools = this.createBrowserTools();
        this.session = await this.client.createSession({
            model: model || this.currentModel,
            streaming: true,
            tools,
            systemMessage: {
                content: `
<context>
You are OctoBrowser's AI assistant, powered by GitHub Copilot.
You're a helpful AI integrated into a web browser.
You can help users with:
- Browsing the web and searching for information
- Summarizing web pages
- Answering questions about content they're viewing
- General knowledge and assistance
- Coding and technical questions
</context>

<instructions>
- Be concise and helpful
- When users ask about the current page, use the get_page_content tool
- When users want to search, use the search_web tool
- Format responses using markdown when appropriate
- Be friendly and professional
</instructions>
`,
            },
        });
        this.currentModel = model || this.currentModel;
    }
    createBrowserTools() {
        if (!defineToolFn) {
            return [];
        }
        const callbacks = this.toolCallbacks;
        return [
            defineToolFn('get_page_content', {
                description: 'Get the content/text of the currently active web page in the browser. Use this when the user asks about the page they are viewing.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const content = await callbacks.getPageContent();
                        if (content) {
                            return `Page: ${content.title}\nURL: ${content.url}\n\nContent:\n${content.content}`;
                        }
                        return 'No page content available';
                    }
                    catch (error) {
                        return 'Failed to get page content';
                    }
                },
            }),
            defineToolFn('search_web', {
                description: 'Search the web using Google. Use this when the user wants to search for information online.',
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
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const result = await callbacks.searchWeb(args.query);
                        return `Searched for "${args.query}" - opened search results at ${result.url}`;
                    }
                    catch (error) {
                        return `Failed to search for: ${args.query}`;
                    }
                },
            }),
            defineToolFn('navigate_to_url', {
                description: 'Navigate the browser to a specific URL or website. Use this when the user asks to open a website or go to a URL.',
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to navigate to (e.g., "https://youtube.com" or "youtube.com")',
                        },
                    },
                    required: ['url'],
                },
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        await callbacks.navigateToUrl(args.url);
                        return `Successfully navigated to ${args.url}`;
                    }
                    catch (error) {
                        return `Failed to navigate to: ${args.url}`;
                    }
                },
            }),
            defineToolFn('click_element', {
                description: 'Click on an element on the page using a CSS selector. Use this when the user asks to click a button, link, or other element.',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: {
                            type: 'string',
                            description: 'The CSS selector for the element to click (e.g., "button.submit", "#login-btn", "a[href="/about"]")',
                        },
                    },
                    required: ['selector'],
                },
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const success = await callbacks.clickElement(args.selector);
                        return success ? `Clicked element: ${args.selector}` : `Could not find element: ${args.selector}`;
                    }
                    catch (error) {
                        return `Failed to click element: ${args.selector}`;
                    }
                },
            }),
            defineToolFn('type_text', {
                description: 'Type text into an input field or the currently focused element. Use this when the user asks to type or enter text.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text to type',
                        },
                        selector: {
                            type: 'string',
                            description: 'Optional CSS selector for the input field. If not provided, types into the currently focused element.',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const success = await callbacks.typeText(args.text, args.selector);
                        return success ? `Typed text: "${args.text}"` : 'Failed to type text - no input field found';
                    }
                    catch (error) {
                        return `Failed to type text: ${args.text}`;
                    }
                },
            }),
            defineToolFn('find_in_page', {
                description: 'Find and highlight text on the current page. Use this when the user asks to find or search for text on the page.',
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text to find on the page',
                        },
                    },
                    required: ['text'],
                },
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const result = await callbacks.findInPage(args.text);
                        return result.count > 0
                            ? `Found ${result.count} occurrence(s) of "${args.text}" on the page`
                            : `No matches found for "${args.text}"`;
                    }
                    catch (error) {
                        return `Failed to search for: ${args.text}`;
                    }
                },
            }),
            defineToolFn('scroll_page', {
                description: 'Scroll the current page. Use this when the user asks to scroll up, down, or to the top/bottom of the page.',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            description: 'The direction to scroll: "up", "down", "top" (scroll to top), or "bottom" (scroll to bottom)',
                            enum: ['up', 'down', 'top', 'bottom'],
                        },
                    },
                    required: ['direction'],
                },
                handler: async (args) => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        await callbacks.scrollPage(args.direction);
                        return `Scrolled ${args.direction}`;
                    }
                    catch (error) {
                        return `Failed to scroll ${args.direction}`;
                    }
                },
            }),
            defineToolFn('go_back', {
                description: 'Navigate back in browser history. Use this when the user asks to go back to the previous page.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        await callbacks.goBack();
                        return 'Navigated back';
                    }
                    catch (error) {
                        return 'Failed to go back';
                    }
                },
            }),
            defineToolFn('go_forward', {
                description: 'Navigate forward in browser history. Use this when the user asks to go forward.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        await callbacks.goForward();
                        return 'Navigated forward';
                    }
                    catch (error) {
                        return 'Failed to go forward';
                    }
                },
            }),
            defineToolFn('take_screenshot', {
                description: 'Take a screenshot of the current page. Use this when the user asks for a screenshot or to capture the page.',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
                handler: async () => {
                    if (!callbacks) {
                        return 'Browser tools not available';
                    }
                    try {
                        const dataUrl = await callbacks.takeScreenshot();
                        return dataUrl ? 'Screenshot captured successfully' : 'Failed to capture screenshot';
                    }
                    catch (error) {
                        return 'Failed to take screenshot';
                    }
                },
            }),
        ];
    }
    async sendMessage(message, model) {
        if (!this.session) {
            throw new Error('Session not created');
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
            return content;
        }
        catch (error) {
            console.error('Error sending message:', error);
            throw error;
        }
    }
    async streamMessage(message, model, onChunk) {
        if (!this.client) {
            throw new Error('Client not initialized');
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
            let unsubscribe = null;
            let hasReceivedContent = false;
            let toolsExecuting = false;
            const handleEvent = (event) => {
                console.log('Stream event:', event.type);
                if (event.type === 'assistant.message_delta') {
                    const delta = event.data.deltaContent || '';
                    if (delta) {
                        hasReceivedContent = true;
                        fullContent += delta;
                        onChunk(delta);
                    }
                }
                else if (event.type === 'tool.call') {
                    // Tool is being executed
                    toolsExecuting = true;
                    const toolName = event.data.name || 'tool';
                    if (!hasReceivedContent) {
                        onChunk(`*Using ${toolName}...*\n\n`);
                    }
                }
                else if (event.type === 'tool.result') {
                    // Tool finished
                    toolsExecuting = false;
                }
                else if (event.type === 'assistant.message') {
                    const content = event.data.content || fullContent;
                    this.conversationHistory.push({ role: 'assistant', content });
                    // If we got a final message but no streaming content, send it now
                    if (!hasReceivedContent && content) {
                        onChunk(content);
                        fullContent = content;
                    }
                }
                else if (event.type === 'session.idle') {
                    if (unsubscribe)
                        unsubscribe();
                    resolve(fullContent);
                }
                else if (event.type === 'session.error') {
                    if (unsubscribe)
                        unsubscribe();
                    const errorMsg = event.data.message || 'Session error';
                    reject(new Error(errorMsg));
                }
            };
            unsubscribe = this.session.on(handleEvent);
            this.session.send({ prompt: message }).catch((err) => {
                if (unsubscribe)
                    unsubscribe();
                reject(err);
            });
        });
    }
    async getModels() {
        if (!this.client) {
            // Return default models if not connected
            return [
                { id: 'gpt-4.1', name: 'GPT-4.1' },
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: 'gpt-5', name: 'GPT-5' },
                { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
                { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
                { id: 'o1', name: 'O1' },
                { id: 'o3-mini', name: 'O3 Mini' },
            ];
        }
        try {
            const models = await this.client.listModels();
            return models.map((m) => ({
                id: m.id,
                name: m.name || m.id,
            }));
        }
        catch (error) {
            console.error('Failed to get models:', error);
            // Return default models on error
            return [
                { id: 'gpt-4.1', name: 'GPT-4.1' },
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
            ];
        }
    }
    getConversationHistory() {
        return [...this.conversationHistory];
    }
    clearHistory() {
        this.conversationHistory = [];
    }
    async stop() {
        try {
            if (this.session) {
                try {
                    await this.session.destroy();
                }
                catch (e) {
                    // Ignore session cleanup errors
                }
                this.session = null;
            }
            if (this.client) {
                try {
                    await this.client.stop();
                }
                catch (e) {
                    // Ignore client cleanup errors
                }
                this.client = null;
            }
            this.isInitialized = false;
        }
        catch (error) {
            // Ignore cleanup errors
            console.log('Copilot service stopped');
        }
    }
}
