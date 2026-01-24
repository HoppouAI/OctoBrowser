/**
 * OctoBrowser - AI-Powered Web Browser with GitHub Copilot SDK
 * Main Process
 */

import { app, BrowserWindow, ipcMain, session, Menu, shell, nativeTheme, clipboard } from 'electron';
import * as path from 'path';
import { CopilotService } from './copilot-service';
import { TabManager } from './tab-manager';
import { SettingsStore } from './settings-store';
import { HistoryStore } from './history-store';

// Disable hardware acceleration on older systems if needed
// app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let copilotService: CopilotService | null = null;
let tabManager: TabManager | null = null;
let settingsStore: SettingsStore;
let historyStore: HistoryStore;

let pendingUserQuestionResolver: ((answers: any) => void) | null = null;

const isDev = !app.isPackaged;

function createMainWindow(): BrowserWindow {
    // Get saved window bounds
    const savedBounds = settingsStore.get('windowBounds') as { width: number; height: number; x?: number; y?: number } | undefined;
    const initialSidebarWidth = (settingsStore.get('sidebarWidth') as number) || 380;
    
    mainWindow = new BrowserWindow({
        width: savedBounds?.width || 1400,
        height: savedBounds?.height || 900,
        x: savedBounds?.x,
        y: savedBounds?.y,
        minWidth: 1024,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            sandbox: false,
        },
        icon: path.join(__dirname, '../../assets/icon.png'),
        show: false,
    });

    // Load the main UI
    mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        // Dev tools disabled by default - use Ctrl+Shift+I or View menu
    });

    // Save window bounds on close
    mainWindow.on('close', () => {
        if (mainWindow) {
            const bounds = mainWindow.getBounds();
            settingsStore.set('windowBounds', bounds);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize tab manager
    tabManager = new TabManager(mainWindow, initialSidebarWidth);

    return mainWindow;
}

function setupIpcHandlers(): void {
    // Window controls
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });
    ipcMain.on('window:close', () => mainWindow?.close());
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

    // Navigation
    ipcMain.on('nav:go', (_event, url: string) => tabManager?.navigate(url));
    ipcMain.on('nav:back', () => tabManager?.goBack());
    ipcMain.on('nav:forward', () => tabManager?.goForward());
    ipcMain.on('nav:reload', () => tabManager?.reload());
    ipcMain.on('nav:stop', () => tabManager?.stop());

    // Tab management
    ipcMain.on('tab:new', (_event, url?: string) => tabManager?.createTab(url));
    ipcMain.on('tab:close', (_event, id: string) => tabManager?.closeTab(id));
    ipcMain.on('tab:restore', () => tabManager?.restoreRecentTab());
    ipcMain.on('tab:closeOther', (_event, id: string) => tabManager?.closeOtherTabs(id));
    ipcMain.on('tab:closeRight', (_event, id: string) => tabManager?.closeTabsToRight(id));
    ipcMain.on('tab:closeAll', () => tabManager?.closeAllTabs());
    ipcMain.on('tab:select', (_event, id: string) => tabManager?.selectTab(id));
    ipcMain.handle('tab:getAll', () => tabManager?.getAllTabs());
    ipcMain.handle('tab:getActive', () => tabManager?.getActiveTab());

    // Sidebar visibility & Resizing
    ipcMain.on('sidebar:setVisible', (_event, visible: boolean) => {
        tabManager?.setSidebarVisible(visible);
    });
    ipcMain.on('sidebar:resize', (_event, width: number) => {
        tabManager?.setSidebarWidth(width);
    });
    ipcMain.on('browser:setModalOpen', (_event, isOpen: boolean) => {
        tabManager?.setModalOpen(isOpen);
    });

    // History
    ipcMain.handle('history:get', () => historyStore.getSessions());
    ipcMain.handle('history:load', (_event, id: string) => historyStore.getSession(id));
    ipcMain.on('history:save', (_event, session) => historyStore.saveSession(session));
    ipcMain.on('history:delete', (_event, id: string) => historyStore.deleteSession(id));
    ipcMain.on('history:clear', () => historyStore.clear());

    // Copilot
    ipcMain.handle('copilot:init', async () => {
        if (!copilotService) {
            copilotService = new CopilotService();
            
            // Set up tool callbacks
            copilotService.setToolCallbacks({
                navigateToUrl: async (url: string, target: 'current_tab' | 'new_tab' = 'current_tab') => {
                    if (target === 'new_tab') {
                        tabManager?.createTab(url);
                    } else {
                        // Default to current tab
                        tabManager?.navigate(url);
                    }
                },
                getOpenTabs: async () => {
                    return tabManager?.getAllTabs().map((tab: any) => ({
                        id: tab.id,
                        title: tab.title,
                        url: tab.url
                    })) || [];
                },
                closeTab: async (tabId: string) => {
                    return tabManager?.closeTab(tabId) || false;
                },
                searchWeb: async (query: string) => {
                    // Use DuckDuckGo to avoid bot detection issues
                    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
                    // Create a new tab for search results to ensure visibility
                    if (tabManager) {
                        tabManager.createTab(searchUrl);
                    }
                    return { url: searchUrl };
                },
                searchYouTube: async (query: string) => {
                    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                    // Create a new tab for search results
                    if (tabManager) {
                        tabManager.createTab(searchUrl);
                    }
                    return { url: searchUrl };
                },
                getPageContent: async () => {
                    return tabManager?.getActivePageContent() || null;
                },
                clickElement: async (selector: string) => {
                    return tabManager?.clickElement(selector) || false;
                },
                clickElementByText: async (text: string) => {
                    return tabManager?.clickElementByText(text) || false;
                },
                typeText: async (text: string, selector?: string) => {
                    return tabManager?.typeText(text, selector) || false;
                },
                findInPage: async (text: string) => {
                    return tabManager?.findInPage(text) || { count: 0 };
                },
                scrollPage: async (direction: 'up' | 'down' | 'top' | 'bottom') => {
                    await tabManager?.scrollPage(direction);
                },
                goBack: async () => {
                    tabManager?.goBack();
                },
                goForward: async () => {
                    tabManager?.goForward();
                },
                takeScreenshot: async () => {
                    return tabManager?.takeScreenshot() || null;
                },
                wait: async (duration: number, selector?: string) => {
                    return tabManager?.wait(duration, selector) || false;
                },
                askUser: async (questions: any[]) => {
                    if (!mainWindow) return null;
                    
                    // Send questions to renderer
                    mainWindow.webContents.send('copilot:ask-user', questions);
                    
                    // Return a promise that resolves when the user answers
                    return new Promise((resolve) => {
                        pendingUserQuestionResolver = resolve;
                    });
                },
                getClickableLinks: async () => {
                    return tabManager?.getClickableLinks() || [];
                },
                clickByIndex: async (index: number) => {
                    return tabManager?.clickByIndex(index) || false;
                },
                searchInPage: async (text: string) => {
                    return tabManager?.searchInPage(text) || { found: false, matches: [] };
                },
                getVisualDescription: async () => {
                    return tabManager?.getVisualDescription() || 'No visual description available';
                },
                saveScreenshotToFile: async () => {
                    return tabManager?.saveScreenshotToFile() || null;
                },
            });
        }
        return copilotService.initialize();
    });

    ipcMain.handle('copilot:answer-user', async (_event, answers: any) => {
        if (pendingUserQuestionResolver) {
            pendingUserQuestionResolver(answers);
            pendingUserQuestionResolver = null;
        }
        return true;
    });

    ipcMain.handle('copilot:sendMessage', async (_event, message: string, model?: string) => {
        if (!copilotService) {
            throw new Error('Copilot not initialized');
        }
        return copilotService.sendMessage(message, model);
    });

    ipcMain.handle('copilot:getModels', async () => {
        if (!copilotService) {
            throw new Error('Copilot not initialized');
        }
        return copilotService.getModels();
    });

    ipcMain.handle('copilot:getPageContent', async () => {
        return tabManager?.getActivePageContent();
    });

    ipcMain.handle('copilot:searchWeb', async (_event, query: string) => {
        // Create a new tab with search
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        tabManager?.createTab(searchUrl);
        return { success: true, url: searchUrl };
    });

    ipcMain.on('copilot:stream-start', (_event, message: string, model?: string) => {
        copilotService?.streamMessage(message, model, (event: { type: string; data?: any }) => {
            mainWindow?.webContents.send('copilot:stream-event', event);
        }).then((result: string) => {
            mainWindow?.webContents.send('copilot:stream-end', result);
        }).catch((error: Error) => {
            mainWindow?.webContents.send('copilot:stream-error', error.message);
        });
    });

    ipcMain.on('copilot:abort', () => {
        copilotService?.abort();
    });

    // Settings
    ipcMain.handle('settings:get', (_event, key: string) => settingsStore.get(key));
    ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
        settingsStore.set(key, value);
        return true;
    });
    ipcMain.handle('settings:getTheme', () => settingsStore.get('theme') || 'system');
    ipcMain.on('settings:setTheme', (_event, theme: string) => {
        settingsStore.set('theme', theme);
        mainWindow?.webContents.send('theme:changed', theme);
    });

    // External links
    ipcMain.on('shell:openExternal', (_event, url: string) => {
        shell.openExternal(url);
    });
    
    // Clipboard
    ipcMain.on('clipboard:write', (_event, text: string) => {
        clipboard.writeText(text);
    });

    // Context Menu
    ipcMain.on('show-tab-context-menu', (_event, data: { tabId?: string; x: number; y: number }) => {
        const template: Electron.MenuItemConstructorOptions[] = [];

        if (data.tabId) {
            template.push(
                {
                    label: 'New Tab',
                    click: () => tabManager?.createTab()
                },
                { type: 'separator' },
                {
                    label: 'Close Tab',
                    click: () => tabManager?.closeTab(data.tabId!)
                },
                {
                    label: 'Close Other Tabs',
                    click: () => tabManager?.closeOtherTabs(data.tabId!)
                },
                {
                    label: 'Close Tabs to Right',
                    click: () => tabManager?.closeTabsToRight(data.tabId!)
                },
                { type: 'separator' },
                {
                    label: 'Close All Tabs',
                    click: () => tabManager?.closeAllTabs()
                }
            );
        } else {
            // General title bar context
            template.push(
                {
                    label: 'New Tab',
                    click: () => tabManager?.createTab()
                },
                {
                    label: 'Reopen Closed Tab',
                    click: () => tabManager?.restoreRecentTab()
                },
                { type: 'separator' },
                {
                    label: 'Close All Tabs',
                    click: () => tabManager?.closeAllTabs()
                }
            );
        }

        const menu = Menu.buildFromTemplate(template);
        menu.popup({
            window: mainWindow || undefined,
            x: Math.round(data.x),
            y: Math.round(data.y)
        });
    });
}

function setupWebviewPermissions(): void {
    // Handle webview permissions
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'geolocation', 'notifications', 'clipboard-read'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Set user agent - use realistic Chrome UA to avoid bot detection
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    session.defaultSession.setUserAgent(userAgent);
}

function createMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tabManager?.createTab() },
                { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => tabManager?.closeActiveTab() },
                { type: 'separator' },
                { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About OctoBrowser',
                    click: () => {
                        mainWindow?.webContents.send('show:about');
                    }
                },
                {
                    label: 'GitHub Repository',
                    click: () => shell.openExternal('https://github.com/github/copilot-sdk')
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// App lifecycle
app.whenReady().then(async () => {
    // Initialize settings store
    settingsStore = new SettingsStore();
    historyStore = new HistoryStore();
    
    // Apply theme
    const theme = settingsStore.get('theme') as string;
    if (theme === 'dark') {
        nativeTheme.themeSource = 'dark';
    } else if (theme === 'light') {
        nativeTheme.themeSource = 'light';
    } else {
        nativeTheme.themeSource = 'system';
    }

    
    // Load uBlock Origin if enabled
    const ublockEnabled = settingsStore.get('ublockEnabled') !== false; // Default to true
    if (ublockEnabled) {
        try {
            const extensionPath = path.join(__dirname, '../../extensions/ublock/uBlock0.chromium');
            await session.defaultSession.loadExtension(extensionPath);
            console.log('uBlock Origin loaded');
        } catch (err) {
            console.error('Failed to load uBlock Origin:', err);
        }
    }

    setupIpcHandlers();
    setupWebviewPermissions();
    createMainWindow();
    createMenu();
});

app.on('window-all-closed', async () => {
    // Clean up Copilot service
    if (copilotService) {
        await copilotService.stop();
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// Handle second instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
