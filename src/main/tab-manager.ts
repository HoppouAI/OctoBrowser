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
                    // Helper to check if element is visible
                    function isVisible(el) {
                        // Fast check for common hidden attributes
                        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
                         
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                    }

                    // Markdown-like text extractor that includes URLs
                    function traverse(node, buffer) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent.replace(/[\\n\\r]+/g, ' ').replace(/\\s{2,}/g, ' ');
                            if (text.trim().length > 0) buffer.push(text);
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            if (!isVisible(node)) return;
                            
                            const tagName = node.tagName;
                            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'PATH', 'META', 'LINK'].includes(tagName)) return;
                            
                            // Block-level elements adding newline
                            const isBlock = ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'ARTICLE', 'SECTION', 'MAIN', 'HEADER', 'FOOTER'].includes(tagName);
                            
                            if (isBlock && buffer.length > 0 && !buffer[buffer.length-1].endsWith('\\n')) {
                                buffer.push('\\n');
                            }

                            // Handle Links specifically: [Text](URL)
                            if (tagName === 'A') {
                                const href = node.getAttribute('href');
                                if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                                     buffer.push(' [');
                                     // Recurse for link text
                                     for (const child of node.childNodes) traverse(child, buffer);
                                     
                                     // Resolve relative URLs
                                     let fullUrl = href;
                                     try {
                                         fullUrl = new URL(href, window.location.href).href;
                                     } catch(e) {}
                                     
                                     buffer.push('](' + fullUrl + ') ');
                                     return; 
                                }
                            }

                            for (const child of node.childNodes) {
                                traverse(child, buffer);
                            }
                            
                            if (isBlock) buffer.push('\\n');
                        }
                    }
                    
                    // Attempt to find the main content area to reduce noise
                    const mainContent = document.querySelector('main, [role="main"], #content, #primary, #main') || document.body;
                    
                    const buffer = [];
                    traverse(mainContent, buffer);
                    
                    // Join and cleanup multiple newlines
                    let content = buffer.join('').replace(/\\n\\s*\\n/g, '\\n\\n').trim();
                    
                    return {
                        title: document.title,
                        url: window.location.href,
                        content: content.substring(0, 8000) // Increased limit to accommodate URLs
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

    async clickElementByText(text: string): Promise<boolean> {
        if (!this.activeTabId) return false;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return false;

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const text = ${JSON.stringify(text)}.toLowerCase();
                    const selectors = 'a, button, [role="button"], input[type="submit"], input[type="button"], h1, h2, h3, h4, h5, h6, span, div';
                    const elements = Array.from(document.querySelectorAll(selectors));
                    
                    // Filter for visible elements only
                    const visibleElements = elements.filter(el => {
                         const style = window.getComputedStyle(el);
                         return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
                    });

                    // 1. Exact match
                    let target = visibleElements.find(el => el.innerText.trim().toLowerCase() === text);
                    
                    // 2. Contains match (prioritize buttons/links)
                    if (!target) {
                        target = visibleElements.find(el => {
                            const isClickable = el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
                            return isClickable && el.innerText.toLowerCase().includes(text);
                        });
                    }

                    // 3. Any contains match
                    if (!target) {
                        target = visibleElements.find(el => el.innerText.toLowerCase().includes(text));
                    }
                    
                    if (target) {
                        // Start from target and walk up to find clickable parent if the target itself isn't obviously clickable
                        let clickable = target;
                        const maxDepth = 5;
                        let depth = 0;
                        
                        while (clickable && clickable !== document.body && depth < maxDepth) {
                            if (clickable.tagName === 'A' || clickable.tagName === 'BUTTON' || clickable.getAttribute('role') === 'button' || clickable.onclick || clickable.getAttribute('jsaction')) {
                                clickable.click();
                                // Also try sending a MouseEvent for custom frameworks like React/Angular sometimes
                                const clickEvent = new MouseEvent('click', {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true
                                });
                                clickable.dispatchEvent(clickEvent);
                                return true;
                            }
                            clickable = clickable.parentElement;
                            depth++;
                        }
                        
                        // Fallback: just click the target element itself
                        target.click();
                        return true;
                    }
                    return false;
                })();
            `);
            return result;
        } catch (error) {
            console.error('Failed to click element by text:', error);
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

    async getClickableLinks(): Promise<Array<{ text: string; url: string; type: string }>> {
        if (!this.activeTabId) return [];
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return [];

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const links = [];
                    const seen = new Set();
                    
                    // Helper to check visibility
                    function isVisible(el) {
                        if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
                        const rect = el.getBoundingClientRect();
                        if (rect.width === 0 || rect.height === 0) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                    }
                    
                    // Get text content, preferring aria-label or title
                    function getText(el) {
                        return (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim().substring(0, 200);
                    }
                    
                    // YouTube-specific: Extract video results
                    const ytVideos = document.querySelectorAll('ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-renderer');
                    ytVideos.forEach((video, index) => {
                        const titleEl = video.querySelector('#video-title, a#video-title-link, h3 a');
                        const channelEl = video.querySelector('#channel-name a, #text.ytd-channel-name, .ytd-channel-name');
                        if (titleEl && isVisible(video)) {
                            const href = titleEl.getAttribute('href');
                            if (href && !seen.has(href)) {
                                seen.add(href);
                                let fullUrl = href;
                                try { fullUrl = new URL(href, window.location.href).href; } catch(e) {}
                                
                                const title = getText(titleEl);
                                const channel = channelEl ? getText(channelEl) : '';
                                links.push({
                                    text: title + (channel ? ' — ' + channel : ''),
                                    url: fullUrl,
                                    type: 'youtube-video',
                                    index: index + 1
                                });
                            }
                        }
                    });
                    
                    // Generic links
                    const allLinks = document.querySelectorAll('a[href]');
                    allLinks.forEach(a => {
                        if (!isVisible(a)) return;
                        const href = a.getAttribute('href');
                        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
                        if (seen.has(href)) return;
                        
                        const text = getText(a);
                        if (!text || text.length < 2) return;
                        
                        seen.add(href);
                        let fullUrl = href;
                        try { fullUrl = new URL(href, window.location.href).href; } catch(e) {}
                        
                        links.push({ text, url: fullUrl, type: 'link' });
                    });
                    
                    // Buttons
                    const buttons = document.querySelectorAll('button, [role="button"]');
                    buttons.forEach(btn => {
                        if (!isVisible(btn)) return;
                        const text = getText(btn);
                        if (text && text.length > 1) {
                            links.push({ text, url: '', type: 'button' });
                        }
                    });
                    
                    return links.slice(0, 50); // Limit to prevent huge payloads
                })();
            `);
            return result;
        } catch (error) {
            console.error('Failed to get clickable links:', error);
            return [];
        }
    }

    async clickByIndex(index: number): Promise<boolean> {
        if (!this.activeTabId) return false;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return false;

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const index = ${index};
                    
                    // YouTube-specific: Click video by index
                    const ytVideos = Array.from(document.querySelectorAll('ytd-video-renderer, ytd-compact-video-renderer'));
                    const visibleVideos = ytVideos.filter(v => {
                        const rect = v.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    });
                    
                    if (index >= 1 && index <= visibleVideos.length) {
                        const video = visibleVideos[index - 1];
                        const titleLink = video.querySelector('#video-title, a#video-title-link, h3 a');
                        if (titleLink) {
                            titleLink.click();
                            return { success: true, clicked: titleLink.innerText.trim().substring(0, 100) };
                        }
                    }
                    
                    return { success: false, error: 'Video at index ' + index + ' not found. Found ' + visibleVideos.length + ' videos.' };
                })();
            `);
            return result.success;
        } catch (error) {
            console.error('Failed to click by index:', error);
            return false;
        }
    }

    async searchInPage(text: string): Promise<{ found: boolean; matches: string[] }> {
        if (!this.activeTabId) return { found: false, matches: [] };
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return { found: false, matches: [] };

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const searchText = ${JSON.stringify(text)}.toLowerCase();
                    const matches = [];
                    
                    // Search in all text nodes
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    
                    let node;
                    while (node = walker.nextNode()) {
                        const content = node.textContent.toLowerCase();
                        if (content.includes(searchText)) {
                            // Get surrounding context
                            const parent = node.parentElement;
                            if (parent) {
                                const style = window.getComputedStyle(parent);
                                if (style.display !== 'none' && style.visibility !== 'hidden') {
                                    const text = parent.innerText.trim().substring(0, 150);
                                    if (text && !matches.includes(text)) {
                                        matches.push(text);
                                    }
                                }
                            }
                        }
                    }
                    
                    return {
                        found: matches.length > 0,
                        count: matches.length,
                        matches: matches.slice(0, 10) // Limit results
                    };
                })();
            `);
            return result;
        } catch (error) {
            console.error('Failed to search in page:', error);
            return { found: false, matches: [] };
        }
    }

    async getVisualDescription(): Promise<string> {
        if (!this.activeTabId) return 'No active tab';
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return 'No active view';

        try {
            const result = await view.webContents.executeJavaScript(`
                (function() {
                    const output = [];
                    
                    // Page info
                    output.push('=== PAGE VISUAL DESCRIPTION ===');
                    output.push('Title: ' + document.title);
                    output.push('URL: ' + window.location.href);
                    output.push('');
                    
                    // Check if it's a video page
                    const isYouTube = window.location.hostname.includes('youtube.com');
                    const video = document.querySelector('video');
                    
                    if (isYouTube) {
                        output.push('=== YOUTUBE PAGE ===');
                        
                        // Check if it's a watch page
                        if (window.location.pathname === '/watch') {
                            output.push('Page Type: VIDEO PLAYER');
                            
                            // Video title
                            const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
                            if (titleEl) output.push('Video Title: ' + titleEl.innerText.trim());
                            
                            // Channel
                            const channelEl = document.querySelector('#channel-name a, ytd-channel-name a');
                            if (channelEl) output.push('Channel: ' + channelEl.innerText.trim());
                            
                            // Video state
                            if (video) {
                                output.push('');
                                output.push('=== VIDEO PLAYER STATE ===');
                                output.push('Video Duration: ' + Math.floor(video.duration || 0) + ' seconds');
                                output.push('Current Time: ' + Math.floor(video.currentTime || 0) + ' seconds');
                                output.push('Paused: ' + video.paused);
                                output.push('Muted: ' + video.muted);
                                output.push('Volume: ' + Math.round((video.volume || 0) * 100) + '%');
                                
                                // Check for ads
                                const adShowing = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text');
                                if (adShowing) {
                                    output.push('AD IS CURRENTLY PLAYING');
                                    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
                                    if (skipBtn) output.push('Skip Ad button is available');
                                }
                                
                                // Processing/loading state
                                const spinner = document.querySelector('.ytp-spinner');
                                if (spinner && window.getComputedStyle(spinner).display !== 'none') {
                                    output.push('VIDEO IS LOADING/BUFFERING');
                                }
                            }
                            
                            // Views/likes
                            const viewCount = document.querySelector('#count .ytd-video-view-count-renderer, ytd-video-view-count-renderer');
                            if (viewCount) output.push('Views: ' + viewCount.innerText.trim());
                            
                        } else if (window.location.pathname === '/results') {
                            output.push('Page Type: SEARCH RESULTS');
                            
                            // Get search query
                            const searchInput = document.querySelector('input#search');
                            if (searchInput) output.push('Search Query: ' + searchInput.value);
                            
                            // List video results
                            output.push('');
                            output.push('=== VIDEO RESULTS ===');
                            const videos = document.querySelectorAll('ytd-video-renderer');
                            let videoNum = 0;
                            videos.forEach((vid, i) => {
                                if (videoNum >= 10) return;
                                const title = vid.querySelector('#video-title');
                                const channel = vid.querySelector('#channel-name');
                                const url = title ? title.getAttribute('href') : '';
                                if (title && title.innerText.trim()) {
                                    videoNum++;
                                    output.push('[' + videoNum + '] ' + title.innerText.trim());
                                    if (channel) output.push('    Channel: ' + channel.innerText.trim());
                                    if (url) output.push('    URL: https://youtube.com' + url);
                                }
                            });
                        } else {
                            output.push('Page Type: ' + (window.location.pathname.startsWith('/@') ? 'CHANNEL' : 'OTHER'));
                        }
                    } else if (video) {
                        // Generic video page
                        output.push('=== VIDEO DETECTED ===');
                        output.push('Duration: ' + Math.floor(video.duration || 0) + 's');
                        output.push('Playing: ' + !video.paused);
                        output.push('Current Time: ' + Math.floor(video.currentTime || 0) + 's');
                    }
                    
                    // Visible buttons and interactive elements
                    output.push('');
                    output.push('=== VISIBLE BUTTONS & CONTROLS ===');
                    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
                    const visibleButtons = buttons.filter(btn => {
                        const rect = btn.getBoundingClientRect();
                        if (rect.width === 0 || rect.height === 0) return false;
                        const style = window.getComputedStyle(btn);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                    }).slice(0, 15);
                    
                    visibleButtons.forEach(btn => {
                        const text = (btn.getAttribute('aria-label') || btn.innerText || btn.getAttribute('title') || '').trim();
                        if (text && text.length > 1 && text.length < 100) {
                            output.push('• Button: "' + text + '"');
                        }
                    });
                    
                    // Key visible text (headlines, main content)
                    output.push('');
                    output.push('=== KEY VISIBLE TEXT ===');
                    const headings = document.querySelectorAll('h1, h2, h3');
                    headings.forEach((h, i) => {
                        if (i >= 5) return;
                        const text = h.innerText.trim();
                        if (text && text.length > 2 && text.length < 200) {
                            output.push('• ' + h.tagName + ': ' + text);
                        }
                    });
                    
                    // Important notices/alerts
                    const alerts = document.querySelectorAll('[role="alert"], .error, .warning, .notice, .message');
                    alerts.forEach(alert => {
                        const text = alert.innerText.trim();
                        if (text && text.length > 5 && text.length < 200) {
                            output.push('⚠ NOTICE: ' + text);
                        }
                    });
                    
                    // Forms/inputs
                    const inputs = document.querySelectorAll('input[type="text"], input[type="search"], textarea');
                    const visibleInputs = Array.from(inputs).filter(inp => {
                        const rect = inp.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }).slice(0, 5);
                    
                    if (visibleInputs.length > 0) {
                        output.push('');
                        output.push('=== INPUT FIELDS ===');
                        visibleInputs.forEach(inp => {
                            const placeholder = inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || 'text input';
                            const value = inp.value ? ' (contains: "' + inp.value.substring(0, 50) + '")' : ' (empty)';
                            output.push('• ' + placeholder + value);
                        });
                    }
                    
                    return output.join('\\n');
                })();
            `);
            return result;
        } catch (error) {
            console.error('Failed to get visual description:', error);
            return 'Failed to analyze page';
        }
    }

    async saveScreenshotToFile(): Promise<string | null> {
        if (!this.activeTabId) return null;
        
        const view = this.tabs.get(this.activeTabId);
        if (!view) return null;

        try {
            const image = await view.webContents.capturePage();
            const pngBuffer = image.toPNG();
            
            // Save to temp directory
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            
            const tempDir = os.tmpdir();
            const filename = `octobrowser_screenshot_${Date.now()}.png`;
            const filePath = path.join(tempDir, filename);
            
            fs.writeFileSync(filePath, pngBuffer);
            
            return filePath;
        } catch (error) {
            console.error('Failed to save screenshot to file:', error);
            return null;
        }
    }
}
