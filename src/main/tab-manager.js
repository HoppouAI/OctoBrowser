/**
 * Tab Manager - Handles browser tab management
 */
import { BrowserView } from 'electron';
export class TabManager {
    window;
    tabs = new Map();
    activeTabId = null;
    tabCounter = 0;
    sidebarVisible = true;
    sidebarWidth = 380;
    constructor(window) {
        this.window = window;
        this.setupEventListeners();
        // Create initial tab after a short delay to ensure renderer is ready
        setTimeout(() => this.createTab(), 300);
    }
    setSidebarVisible(visible) {
        this.sidebarVisible = visible;
        this.updateActiveViewBounds();
    }
    setupEventListeners() {
        // Listen for maximize/unmaximize to adjust view bounds
        this.window.on('maximize', () => this.updateActiveViewBounds());
        this.window.on('unmaximize', () => this.updateActiveViewBounds());
        this.window.on('resize', () => this.updateActiveViewBounds());
    }
    generateTabId() {
        return `tab-${++this.tabCounter}-${Date.now()}`;
    }
    createTab(url) {
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
        // Select the new tab
        this.selectTab(tabId);
        // Notify renderer
        this.window.webContents.send('tab:created', this.getTabInfo(tabId, view));
        return tabId;
    }
    setupWebContentsHandlers(tabId, webContents) {
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
    }
    updateNavigationState(tabId) {
        const view = this.tabs.get(tabId);
        if (view) {
            this.window.webContents.send('tab:navigationState', tabId, {
                canGoBack: view.webContents.canGoBack(),
                canGoForward: view.webContents.canGoForward(),
            });
        }
    }
    selectTab(tabId) {
        const view = this.tabs.get(tabId);
        if (!view)
            return false;
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
    updateActiveViewBounds() {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return;
        const contentBounds = this.window.getContentBounds();
        // Calculate the view bounds (accounting for title bar and tab bar)
        // Title bar: ~32px, Tab bar: ~40px, URL bar: ~50px = ~122px total
        const topOffset = 122;
        // Account for sidebar if visible
        const sidebarOffset = this.sidebarVisible ? this.sidebarWidth : 0;
        view.setBounds({
            x: 0,
            y: topOffset,
            width: contentBounds.width - sidebarOffset,
            height: contentBounds.height - topOffset,
        });
        view.setAutoResize({
            width: true,
            height: true,
            horizontal: true,
            vertical: true,
        });
    }
    closeTab(tabId) {
        const view = this.tabs.get(tabId);
        if (!view)
            return false;
        // If closing active tab, switch to another
        if (this.activeTabId === tabId) {
            const tabIds = Array.from(this.tabs.keys());
            const currentIndex = tabIds.indexOf(tabId);
            let nextTabId = null;
            if (tabIds.length > 1) {
                // Select next tab or previous if this is the last
                nextTabId = tabIds[currentIndex + 1] || tabIds[currentIndex - 1];
            }
            if (nextTabId) {
                this.selectTab(nextTabId);
            }
            else {
                // Create a new tab if this was the last one
                this.createTab();
            }
        }
        // Remove and destroy the view
        this.window.removeBrowserView(view);
        view.webContents.destroy?.();
        this.tabs.delete(tabId);
        // Notify renderer
        this.window.webContents.send('tab:closed', tabId);
        return true;
    }
    closeActiveTab() {
        if (this.activeTabId) {
            this.closeTab(this.activeTabId);
        }
    }
    navigate(url) {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.loadURL(this.normalizeUrl(url));
        }
    }
    goBack() {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (view && view.webContents.canGoBack()) {
            view.webContents.goBack();
        }
    }
    goForward() {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (view && view.webContents.canGoForward()) {
            view.webContents.goForward();
        }
    }
    reload() {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.reload();
        }
    }
    stop() {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (view) {
            view.webContents.stop();
        }
    }
    normalizeUrl(url) {
        if (!url)
            return 'https://github.com';
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
    getTabInfo(tabId, view) {
        return {
            id: tabId,
            title: view.webContents.getTitle() || 'New Tab',
            url: view.webContents.getURL() || '',
            isLoading: view.webContents.isLoading(),
            canGoBack: view.webContents.canGoBack(),
            canGoForward: view.webContents.canGoForward(),
        };
    }
    getAllTabs() {
        return Array.from(this.tabs.entries()).map(([id, view]) => this.getTabInfo(id, view));
    }
    getActiveTab() {
        if (!this.activeTabId)
            return null;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return null;
        return this.getTabInfo(this.activeTabId, view);
    }
    async getActivePageContent() {
        if (!this.activeTabId)
            return null;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return null;
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
                    
                    const mainContent = document.querySelector('main, article, [role="main"], #content, .content') || document.body;
                    const content = getTextContent(mainContent)
                        .replace(/\\s+/g, ' ')
                        .trim()
                        .substring(0, 10000); // Limit content length
                    
                    return {
                        title: document.title,
                        url: window.location.href,
                        content: content
                    };
                })();
            `);
            return result;
        }
        catch (error) {
            console.error('Failed to get page content:', error);
            return null;
        }
    }
    async clickElement(selector) {
        if (!this.activeTabId)
            return false;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return false;
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
        }
        catch (error) {
            console.error('Failed to click element:', error);
            return false;
        }
    }
    async typeText(text, selector) {
        if (!this.activeTabId)
            return false;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return false;
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
        }
        catch (error) {
            console.error('Failed to type text:', error);
            return false;
        }
    }
    async findInPage(text) {
        if (!this.activeTabId)
            return { count: 0 };
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return { count: 0 };
        return new Promise((resolve) => {
            let count = 0;
            view.webContents.once('found-in-page', (_event, result) => {
                count = result.matches || 0;
                resolve({ count });
            });
            view.webContents.findInPage(text);
            // Timeout fallback
            setTimeout(() => resolve({ count }), 2000);
        });
    }
    async scrollPage(direction) {
        if (!this.activeTabId)
            return;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return;
        try {
            const scrollScript = {
                up: 'window.scrollBy(0, -window.innerHeight * 0.8)',
                down: 'window.scrollBy(0, window.innerHeight * 0.8)',
                top: 'window.scrollTo(0, 0)',
                bottom: 'window.scrollTo(0, document.body.scrollHeight)',
            };
            await view.webContents.executeJavaScript(scrollScript[direction]);
        }
        catch (error) {
            console.error('Failed to scroll:', error);
        }
    }
    async takeScreenshot() {
        if (!this.activeTabId)
            return null;
        const view = this.tabs.get(this.activeTabId);
        if (!view)
            return null;
        try {
            const image = await view.webContents.capturePage();
            return image.toDataURL();
        }
        catch (error) {
            console.error('Failed to take screenshot:', error);
            return null;
        }
    }
}
