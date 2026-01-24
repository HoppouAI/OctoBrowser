/**
 * Tab Manager - Handles browser tab management
 */

import { BrowserWindow, BrowserView, ipcMain, WebContents, Menu, clipboard } from 'electron';
import * as path from 'path';

export interface Tab {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    isLoading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}

export class TabManager {
    private window: BrowserWindow;
    private tabs: Map<string, BrowserView> = new Map();
    private activeTabId: string | null = null;
    private tabCounter: number = 0;
    private closedTabs: { url: string; title: string }[] = [];
    private readonly maxClosedTabs: number = 20;
    private sidebarVisible: boolean = true;
    private sidebarWidth: number = 380;
    private isModalOpen: boolean = false;

    constructor(window: BrowserWindow, initialSidebarWidth: number = 380) {
        this.window = window;
        this.sidebarWidth = initialSidebarWidth;
        this.setupEventListeners();
        
        // Start in Zero State (no tabs open)
        setTimeout(() => {
            this.window.webContents.send('tab:zero-state', true);
            this.window.webContents.send('tab:selected', null);
        }, 300);
    }

    setSidebarVisible(visible: boolean): void {
        this.sidebarVisible = visible;
        this.updateActiveViewBounds();
    }

    setSidebarWidth(width: number): void {
        this.sidebarWidth = width;
        this.updateActiveViewBounds();
    }

    setModalOpen(isOpen: boolean): void {
        this.isModalOpen = isOpen;
        this.updateActiveViewBounds();
    }

    private setupEventListeners(): void {
        // Listen for maximize/unmaximize to adjust view bounds
        this.window.on('maximize', () => this.updateActiveViewBounds());
        this.window.on('unmaximize', () => this.updateActiveViewBounds());
        this.window.on('resize', () => this.updateActiveViewBounds());
    }

    private generateTabId(): string {
        return `tab-${++this.tabCounter}-${Date.now()}`;
    }

    createTab(url?: string): string {
        const tabId = this.generateTabId();
        const defaultUrl = url || 'https://github.com';

        const view = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
            },
        });

        // Set up web contents event handlers
        this.setupWebContentsHandlers(tabId, view.webContents);

        // Store the tab
        this.tabs.set(tabId, view);

        // Load the URL
        view.webContents.loadURL(this.normalizeUrl(defaultUrl));

        // Disable zero state if we had no tabs
        this.window.webContents.send('tab:zero-state', false);

        // Select the new tab
        this.selectTab(tabId);

        // Notify renderer
        this.window.webContents.send('tab:created', this.getTabInfo(tabId, view));

        return tabId;
    }

    private setupWebContentsHandlers(tabId: string, webContents: WebContents): void {
        webContents.on('did-start-loading', () => {
            this.window.webContents.send('tab:loading', tabId, true);
        });

        webContents.on('did-stop-loading', () => {
            this.window.webContents.send('tab:loading', tabId, false);
        });

        webContents.on('page-title-updated', (_event, title) => {
            this.window.webContents.send('tab:titleUpdated', tabId, title);
        });

        webContents.on('page-favicon-updated', (_event, favicons) => {
            if (favicons.length > 0) {
                this.window.webContents.send('tab:faviconUpdated', tabId, favicons[0]);
            }
        });

        webContents.on('did-navigate', (_event, url) => {
            this.window.webContents.send('tab:urlChanged', tabId, url);
            this.updateNavigationState(tabId);
        });

        webContents.on('did-navigate-in-page', (_event, url) => {
            this.window.webContents.send('tab:urlChanged', tabId, url);
            this.updateNavigationState(tabId);
        });

        // Handle new window requests (open in new tab)
        webContents.setWindowOpenHandler(({ url }) => {
            this.createTab(url);
            return { action: 'deny' };
        });

        // Handle certificate errors (for development)
        webContents.on('certificate-error', (event, _url, _error, _certificate, callback) => {
            event.preventDefault();
            callback(true);
        });

        // Context Menu
        webContents.on('context-menu', (_, params) => {
            const menu = Menu.buildFromTemplate([
                {
                    label: 'Back',
                    enabled: webContents.canGoBack(),
                    click: () => webContents.goBack(),
                },
                {
                    label: 'Forward',
                    enabled: webContents.canGoForward(),
                    click: () => webContents.goForward(),
                },
                {
                    label: 'Reload',
                    click: () => webContents.reload(),
                },
                { type: 'separator' },
                {
                    label: 'Open Link in New Tab',
                    visible: !!params.linkURL,
                    click: () => this.createTab(params.linkURL),
                },
                { type: 'separator' },
                { role: 'cut', enabled: params.editFlags.canCut },
                { role: 'copy', enabled: params.editFlags.canCopy },
                { role: 'paste', enabled: params.editFlags.canPaste },
                { type: 'separator' },
                {
                    label: 'Save Image As...',
                    visible: params.mediaType === 'image',
                    click: () => webContents.downloadURL(params.srcURL),
                },
                { type: 'separator' },
                {
                    label: 'Inspect Element',
                    click: () => {
                        webContents.inspectElement(params.x, params.y);
                        if (webContents.isDevToolsOpened()) {
                            webContents.devToolsWebContents?.focus();
                        }
                    },
                },
            ]);
            menu.popup();
        });
    }

    private updateNavigationState(tabId: string): void {
        const view = this.tabs.get(tabId);
        if (view) {
            this.window.webContents.send('tab:navigationState', tabId, {
                canGoBack: view.webContents.canGoBack(),
                canGoForward: view.webContents.canGoForward(),
            });
        }
    }

    selectTab(tabId: string): boolean {
        const view = this.tabs.get(tabId);
        if (!view) return false;

        // Remove current view
        if (this.activeTabId && this.activeTabId !== tabId) {
            const currentView = this.tabs.get(this.activeTabId);
            if (currentView) {
                this.window.removeBrowserView(currentView);
            }
        }

        // Add new view
        this.window.addBrowserView(view);
        this.activeTabId = tabId;
        this.updateActiveViewBounds();

        // Notify renderer
        this.window.webContents.send('tab:selected', tabId);
        this.updateNavigationState(tabId);

        // Send current URL
        const url = view.webContents.getURL();
        this.window.webContents.send('tab:urlChanged', tabId, url);

        return true;
    }

    private updateActiveViewBounds(): void {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return;

        const contentBounds = this.window.getContentBounds();
        
        // Calculate the view bounds (accounting for title bar and nav bar)
        // Title bar: 40px, Nav bar: 46px = 86px total
        const topOffset = 86;
        
        // Account for sidebar if visible
        const sidebarOffset = this.sidebarVisible ? this.sidebarWidth : 0;
        
        if (this.isModalOpen) {
            // Move off-screen to allow modal to be seen
            view.setBounds({
                x: 0,
                y: topOffset,
                width: 0,
                height: 0,
            });
        } else {
            view.setBounds({
                x: 0,
                y: topOffset,
                width: contentBounds.width - sidebarOffset,
                height: contentBounds.height - topOffset,
            });
        }

        view.setAutoResize({
            width: true,
            height: true,
            horizontal: true,
            vertical: true,
        });
    }

    closeTab(tabId: string): boolean {
        const view = this.tabs.get(tabId);
        if (!view) return false;

        // Save to closed tabs history
        const url = view.webContents.getURL();
        const title = view.webContents.getTitle();
        if (url && !url.startsWith('file://')) {
            this.closedTabs.push({ url, title });
            if (this.closedTabs.length > this.maxClosedTabs) {
                this.closedTabs.shift();
            }
        }

        // If closing active tab, switch to another
        if (this.activeTabId === tabId) {
            const tabIds = Array.from(this.tabs.keys());
            const currentIndex = tabIds.indexOf(tabId);
            let nextTabId: string | null = null;

            if (tabIds.length > 1) {
                // Select next tab or previous if this is the last
                nextTabId = tabIds[currentIndex + 1] || tabIds[currentIndex - 1];
            }

            if (nextTabId) {
                this.selectTab(nextTabId);
            } else {
                // Last tab being closed - enter zero state
                this.activeTabId = null;
                this.window.webContents.send('tab:selected', null);
                // Also send a specific event for zero state if needed, but null selection implies it
                this.window.webContents.send('tab:zero-state', true);
            }
        }

        // Remove and destroy the view
        this.window.removeBrowserView(view);
        (view.webContents as any).destroy?.();
        this.tabs.delete(tabId);

        // Notify renderer
        this.window.webContents.send('tab:closed', tabId);

        return true;
    }

    closeActiveTab(): void {
        if (this.activeTabId) {
            this.closeTab(this.activeTabId);
        }
    }

    restoreRecentTab(): void {
        const lastTab = this.closedTabs.pop();
        if (lastTab) {
            this.createTab(lastTab.url);
        }
    }

    closeOtherTabs(keepTabId: string): void {
        const tabIds = Array.from(this.tabs.keys());
        for (const id of tabIds) {
            if (id !== keepTabId) {
                this.closeTab(id);
            }
        }
    }

    closeTabsToRight(fromTabId: string): void {
        const tabIds = Array.from(this.tabs.keys());
        const index = tabIds.indexOf(fromTabId);
        if (index === -1) return;

        // Close all tabs after this index
        for (let i = index + 1; i < tabIds.length; i++) {
            this.closeTab(tabIds[i]);
        }
    }

    closeAllTabs(): void {
        const tabIds = Array.from(this.tabs.keys());
        for (const id of tabIds) {
            this.closeTab(id);
        }
    }

    navigate(url: string): void {
        if (!this.activeTabId) {
            this.createTab(url);
            return;
        }
        
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.loadURL(this.normalizeUrl(url));
        }
    }

    goBack(): void {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (view && view.webContents.canGoBack()) {
            view.webContents.goBack();
        }
    }

    goForward(): void {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (view && view.webContents.canGoForward()) {
            view.webContents.goForward();
        }
    }

    reload(): void {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.reload();
        }
    }

    stop(): void {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.stop();
        }
    }

    private normalizeUrl(url: string): string {
        if (!url) return 'https://github.com';
        
        // Check if it's a search query
        if (!url.includes('.') && !url.startsWith('http') && !url.startsWith('file://')) {
            return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
        }
        
        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
            return `https://${url}`;
        }
        
        return url;
    }

    private getTabInfo(tabId: string, view: BrowserView): Tab {
        return {
            id: tabId,
            title: view.webContents.getTitle() || 'New Tab',
            url: view.webContents.getURL() || '',
            isLoading: view.webContents.isLoading(),
            canGoBack: view.webContents.canGoBack(),
            canGoForward: view.webContents.canGoForward(),
        };
    }

    getAllTabs(): Tab[] {
        return Array.from(this.tabs.entries()).map(([id, view]) => 
            this.getTabInfo(id, view)
        );
    }

    getActiveTab(): Tab | null {
        if (!this.activeTabId) return null;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return null;
        
        return this.getTabInfo(this.activeTabId, view);
    }

    async getActivePageContent(): Promise<{ title: string; url: string; content: string } | null> {
        if (!this.activeTabId) return null;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return null;

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const getTextContent = (element) => {
                        if (!element) return '';
                        
                        // Skip script, style, and other non-content elements
                        const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG'];
                        if (skipTags.includes(element.tagName)) return '';
                        
                        let text = '';
                        for (const child of element.childNodes) {
                            if (child.nodeType === Node.TEXT_NODE) {
                                text += child.textContent + ' ';
                            } else if (child.nodeType === Node.ELEMENT_NODE) {
                                text += getTextContent(child);
                            }
                        }
                        return text;
                    };
                    
                    // Use innerText if available for better visibility filtering, fallback to textContent
                    const mainContent = document.querySelector('main, article, [role="main"], #content, .content') || document.body;
                    const rawText = mainContent.innerText || getTextContent(mainContent);
                    
                    const content = rawText
                        .replace(/\\s+/g, ' ')
                        .trim()
                        .substring(0, 4000); // Limit content length strict to avoid token limits
                    
                    return {
                        title: document.title,
                        url: window.location.href,
                        content: content
                    };
                })();
            `);
            
            return result;
        } catch (error) {
            console.error('Failed to get page content:', error);
            return null;
        }
    }

    async clickElement(selector: string): Promise<boolean> {
        if (!this.activeTabId) return false;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return false;

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const element = document.querySelector(${JSON.stringify(selector)});
                    if (element) {
                        element.click();
                        return true;
                    }
                    return false;
                })();
            `);
            return result;
        } catch (error) {
            console.error('Failed to click element:', error);
            return false;
        }
    }

    async typeText(text: string, selector?: string): Promise<boolean> {
        if (!this.activeTabId) return false;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return false;

        try {
            if (selector) {
                // Focus the element first
                await view.webContents.executeJavaScript(`
                    (function() {
                        const element = document.querySelector(${JSON.stringify(selector)});
                        if (element) {
                            element.focus();
                            return true;
                        }
                        return false;
                    })();
                `);
            }
            
            // Use insertText for more reliable text input
            await view.webContents.insertText(text);
            return true;
        } catch (error) {
            console.error('Failed to type text:', error);
            return false;
        }
    }

    async findInPage(text: string): Promise<{ count: number }> {
        if (!this.activeTabId) return { count: 0 };
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return { count: 0 };

        return new Promise((resolve) => {
            let count = 0;
            
            view.webContents.once('found-in-page', (_event, result) => {
                count = result.matches || 0;
                resolve({ count });
            });
            
            view.webContents.findInPage(text);
            
            // Timeout fallback
            setTimeout(() => {
                // Stop find operation and clear highlighting after getting results
                view.webContents.stopFindInPage('clearSelection');
                resolve({ count });
            }, 2000);
        });
    }

    async scrollPage(direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void> {
        if (!this.activeTabId) return;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return;

        try {
            const scrollScript = {
                up: 'window.scrollBy(0, -window.innerHeight * 0.8)',
                down: 'window.scrollBy(0, window.innerHeight * 0.8)',
                top: 'window.scrollTo(0, 0)',
                bottom: 'window.scrollTo(0, document.body.scrollHeight)',
            };
            
            await view.webContents.executeJavaScript(scrollScript[direction]);
        } catch (error) {
            console.error('Failed to scroll:', error);
        }
    }

    async takeScreenshot(): Promise<string | null> {
        if (!this.activeTabId) return null;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return null;

        try {
            const image = await view.webContents.capturePage();
            return image.toDataURL();
        } catch (error) {
            console.error('Failed to take screenshot:', error);
            return null;
        }
    }

    async wait(duration: number, selector?: string): Promise<boolean> {
        if (!this.activeTabId) return false;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return false;

        try {
            return await view.webContents.executeJavaScript(`
                (async () => {
                    const duration = ${duration};
                    const selector = ${selector ? JSON.stringify(selector) : 'null'};
                    
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    
                    if (selector) {
                        const startTime = Date.now();
                        while (Date.now() - startTime < duration) {
                            if (document.querySelector(selector)) {
                                return true;
                            }
                            await sleep(100);
                        }
                        return false;
                    } else {
                        await sleep(duration);
                        return true;
                    }
                })()
            `);
        } catch (error) {
            console.error('Failed to wait:', error);
            return false;
        }
    }
}
