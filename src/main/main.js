/**
 * OctoBrowser - AI-Powered Web Browser with GitHub Copilot SDK
 * Main Process
 */
import { app, BrowserWindow, ipcMain, session, Menu, shell, nativeTheme } from 'electron';
import * as path from 'path';
import { CopilotService } from './copilot-service';
import { TabManager } from './tab-manager';
import { SettingsStore } from './settings-store';
// Disable hardware acceleration on older systems if needed
// app.disableHardwareAcceleration();
let mainWindow = null;
let copilotService = null;
let tabManager = null;
let settingsStore;
const isDev = !app.isPackaged;
function createMainWindow() {
    // Get saved window bounds
    const savedBounds = settingsStore.get('windowBounds');
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
    tabManager = new TabManager(mainWindow);
    return mainWindow;
}
function setupIpcHandlers() {
    // Window controls
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow?.maximize();
        }
    });
    ipcMain.on('window:close', () => mainWindow?.close());
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());
    // Navigation
    ipcMain.on('nav:go', (_event, url) => tabManager?.navigate(url));
    ipcMain.on('nav:back', () => tabManager?.goBack());
    ipcMain.on('nav:forward', () => tabManager?.goForward());
    ipcMain.on('nav:reload', () => tabManager?.reload());
    ipcMain.on('nav:stop', () => tabManager?.stop());
    // Tab management
    ipcMain.on('tab:new', (_event, url) => tabManager?.createTab(url));
    ipcMain.on('tab:close', (_event, id) => tabManager?.closeTab(id));
    ipcMain.on('tab:select', (_event, id) => tabManager?.selectTab(id));
    ipcMain.handle('tab:getAll', () => tabManager?.getAllTabs());
    ipcMain.handle('tab:getActive', () => tabManager?.getActiveTab());
    // Sidebar visibility
    ipcMain.on('sidebar:setVisible', (_event, visible) => {
        tabManager?.setSidebarVisible(visible);
    });
    // Copilot
    ipcMain.handle('copilot:init', async () => {
        if (!copilotService) {
            copilotService = new CopilotService();
            // Set up tool callbacks
            copilotService.setToolCallbacks({
                navigateToUrl: async (url) => {
                    tabManager?.navigate(url);
                },
                searchWeb: async (query) => {
                    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                    tabManager?.createTab(searchUrl);
                    return { url: searchUrl };
                },
                getPageContent: async () => {
                    return tabManager?.getActivePageContent() || null;
                },
                clickElement: async (selector) => {
                    return tabManager?.clickElement(selector) || false;
                },
                typeText: async (text, selector) => {
                    return tabManager?.typeText(text, selector) || false;
                },
                findInPage: async (text) => {
                    return tabManager?.findInPage(text) || { count: 0 };
                },
                scrollPage: async (direction) => {
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
            });
        }
        return copilotService.initialize();
    });
    ipcMain.handle('copilot:sendMessage', async (_event, message, model) => {
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
    ipcMain.handle('copilot:searchWeb', async (_event, query) => {
        // Create a new tab with search
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        tabManager?.createTab(searchUrl);
        return { success: true, url: searchUrl };
    });
    ipcMain.on('copilot:stream-start', (_event, message, model) => {
        copilotService?.streamMessage(message, model, (chunk) => {
            mainWindow?.webContents.send('copilot:stream-chunk', chunk);
        }).then((result) => {
            mainWindow?.webContents.send('copilot:stream-end', result);
        }).catch((error) => {
            mainWindow?.webContents.send('copilot:stream-error', error.message);
        });
    });
    // Settings
    ipcMain.handle('settings:get', (_event, key) => settingsStore.get(key));
    ipcMain.handle('settings:set', (_event, key, value) => {
        settingsStore.set(key, value);
        return true;
    });
    ipcMain.handle('settings:getTheme', () => settingsStore.get('theme') || 'system');
    ipcMain.on('settings:setTheme', (_event, theme) => {
        settingsStore.set('theme', theme);
        mainWindow?.webContents.send('theme:changed', theme);
    });
    // External links
    ipcMain.on('shell:openExternal', (_event, url) => {
        shell.openExternal(url);
    });
}
function setupWebviewPermissions() {
    // Handle webview permissions
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'geolocation', 'notifications', 'clipboard-read'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        }
        else {
            callback(false);
        }
    });
    // Set user agent
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OctoBrowser/1.0.0 Chrome/120.0.0.0 Safari/537.36';
        callback({ requestHeaders: details.requestHeaders });
    });
}
function createMenu() {
    const template = [
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
    // Apply theme
    const theme = settingsStore.get('theme');
    if (theme === 'dark') {
        nativeTheme.themeSource = 'dark';
    }
    else if (theme === 'light') {
        nativeTheme.themeSource = 'light';
    }
    else {
        nativeTheme.themeSource = 'system';
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
}
else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
}
