/**
 * Preload Script - Exposes safe APIs to renderer
 */
import { contextBridge, ipcRenderer } from 'electron';
// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    // Navigation
    navigate: (url) => ipcRenderer.send('nav:go', url),
    goBack: () => ipcRenderer.send('nav:back'),
    goForward: () => ipcRenderer.send('nav:forward'),
    reload: () => ipcRenderer.send('nav:reload'),
    stop: () => ipcRenderer.send('nav:stop'),
    // Tab management
    newTab: (url) => ipcRenderer.send('tab:new', url),
    closeTab: (id) => ipcRenderer.send('tab:close', id),
    selectTab: (id) => ipcRenderer.send('tab:select', id),
    getAllTabs: () => ipcRenderer.invoke('tab:getAll'),
    getActiveTab: () => ipcRenderer.invoke('tab:getActive'),
    // Sidebar
    setSidebarVisible: (visible) => ipcRenderer.send('sidebar:setVisible', visible),
    // Copilot
    initCopilot: () => ipcRenderer.invoke('copilot:init'),
    sendMessage: (message, model) => ipcRenderer.invoke('copilot:sendMessage', message, model),
    getModels: () => ipcRenderer.invoke('copilot:getModels'),
    getPageContent: () => ipcRenderer.invoke('copilot:getPageContent'),
    searchWeb: (query) => ipcRenderer.invoke('copilot:searchWeb', query),
    startStream: (message, model) => ipcRenderer.send('copilot:stream-start', message, model),
    // Settings
    getSetting: (key) => ipcRenderer.invoke('settings:get', key),
    setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme) => ipcRenderer.send('settings:setTheme', theme),
    // External
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    // Event listeners
    onTabCreated: (callback) => {
        ipcRenderer.on('tab:created', (_event, tab) => callback(tab));
    },
    onTabClosed: (callback) => {
        ipcRenderer.on('tab:closed', (_event, id) => callback(id));
    },
    onTabSelected: (callback) => {
        ipcRenderer.on('tab:selected', (_event, id) => callback(id));
    },
    onTabLoading: (callback) => {
        ipcRenderer.on('tab:loading', (_event, id, isLoading) => callback(id, isLoading));
    },
    onTabTitleUpdated: (callback) => {
        ipcRenderer.on('tab:titleUpdated', (_event, id, title) => callback(id, title));
    },
    onTabFaviconUpdated: (callback) => {
        ipcRenderer.on('tab:faviconUpdated', (_event, id, favicon) => callback(id, favicon));
    },
    onTabUrlChanged: (callback) => {
        ipcRenderer.on('tab:urlChanged', (_event, id, url) => callback(id, url));
    },
    onTabNavigationState: (callback) => {
        ipcRenderer.on('tab:navigationState', (_event, id, state) => callback(id, state));
    },
    onThemeChanged: (callback) => {
        ipcRenderer.on('theme:changed', (_event, theme) => callback(theme));
    },
    onStreamChunk: (callback) => {
        ipcRenderer.on('copilot:stream-chunk', (_event, chunk) => callback(chunk));
    },
    onStreamEnd: (callback) => {
        ipcRenderer.on('copilot:stream-end', (_event, result) => callback(result));
    },
    onStreamError: (callback) => {
        ipcRenderer.on('copilot:stream-error', (_event, error) => callback(error));
    },
    onShowAbout: (callback) => {
        ipcRenderer.on('show:about', () => callback());
    },
    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    },
});
