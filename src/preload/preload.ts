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
    navigate: (url: string) => ipcRenderer.send('nav:go', url),
    goBack: () => ipcRenderer.send('nav:back'),
    goForward: () => ipcRenderer.send('nav:forward'),
    reload: () => ipcRenderer.send('nav:reload'),
    stop: () => ipcRenderer.send('nav:stop'),

    // Tab management
    newTab: (url?: string) => ipcRenderer.send('tab:new', url),
    closeTab: (id: string) => ipcRenderer.send('tab:close', id),
    restoreTab: () => ipcRenderer.send('tab:restore'),
    closeOtherTabs: (id: string) => ipcRenderer.send('tab:closeOther', id),
    closeTabsToRight: (id: string) => ipcRenderer.send('tab:closeRight', id),
    closeAllTabs: () => ipcRenderer.send('tab:closeAll'),
    selectTab: (id: string) => ipcRenderer.send('tab:select', id),
    showTabContextMenu: (data: { tabId?: string; x: number; y: number }) => ipcRenderer.send('show-tab-context-menu', data),
    getAllTabs: () => ipcRenderer.invoke('tab:getAll'),
    getActiveTab: () => ipcRenderer.invoke('tab:getActive'),

    // Sidebar
    setSidebarVisible: (visible: boolean) => ipcRenderer.send('sidebar:setVisible', visible),
    setSidebarWidth: (width: number) => ipcRenderer.send('sidebar:resize', width),
    setModalOpen: (isOpen: boolean) => ipcRenderer.send('browser:setModalOpen', isOpen),

    // History
    getHistory: () => ipcRenderer.invoke('history:get'),
    loadSession: (id: string) => ipcRenderer.invoke('history:load', id),
    saveSession: (session: any) => ipcRenderer.send('history:save', session),
    deleteSession: (id: string) => ipcRenderer.send('history:delete', id),
    clearHistory: () => ipcRenderer.send('history:clear'),

    // Copilot
    initCopilot: () => ipcRenderer.invoke('copilot:init'),
    sendMessage: (message: string, model?: string) => 
        ipcRenderer.invoke('copilot:sendMessage', message, model),
    getModels: () => ipcRenderer.invoke('copilot:getModels'),
    getPageContent: () => ipcRenderer.invoke('copilot:getPageContent'),
    searchWeb: (query: string) => ipcRenderer.invoke('copilot:searchWeb', query),
    startStream: (message: string, model?: string) => 
        ipcRenderer.send('copilot:stream-start', message, model),
    abortStream: () => ipcRenderer.send('copilot:abort'),
    sendAnswer: (answers: any) => ipcRenderer.invoke('copilot:answer-user', answers),

    // Settings
    getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
    setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme: string) => ipcRenderer.send('settings:setTheme', theme),

    // External
    openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
    copyToClipboard: (text: string) => ipcRenderer.send('clipboard:write', text),

    // Event listeners
    onTabCreated: (callback: (tab: unknown) => void) => {
        ipcRenderer.on('tab:created', (_event, tab) => callback(tab));
    },
    onTabClosed: (callback: (id: string) => void) => {
        ipcRenderer.on('tab:closed', (_event, id) => callback(id));
    },
    onTabSelected: (callback: (id: string) => void) => {
        ipcRenderer.on('tab:selected', (_event, id) => callback(id));
    },
    onTabLoading: (callback: (id: string, isLoading: boolean) => void) => {
        ipcRenderer.on('tab:loading', (_event, id, isLoading) => callback(id, isLoading));
    },
    onTabTitleUpdated: (callback: (id: string, title: string) => void) => {
        ipcRenderer.on('tab:titleUpdated', (_event, id, title) => callback(id, title));
    },
    onTabFaviconUpdated: (callback: (id: string, favicon: string) => void) => {
        ipcRenderer.on('tab:faviconUpdated', (_event, id, favicon) => callback(id, favicon));
    },
    onTabUrlChanged: (callback: (id: string, url: string) => void) => {
        ipcRenderer.on('tab:urlChanged', (_event, id, url) => callback(id, url));
    },
    onTabNavigationState: (callback: (id: string, state: { canGoBack: boolean; canGoForward: boolean }) => void) => {
        ipcRenderer.on('tab:navigationState', (_event, id, state) => callback(id, state));
    },
    onThemeChanged: (callback: (theme: string) => void) => {
        ipcRenderer.on('theme:changed', (_event, theme) => callback(theme));
    },
    // Updated to support structured events
    onStreamEvent: (callback: (event: { type: string; data?: any }) => void) => {
        ipcRenderer.on('copilot:stream-event', (_event, event) => callback(event));
    },
    onStreamEnd: (callback: (result: string) => void) => {
        ipcRenderer.on('copilot:stream-end', (_event, result) => callback(result));
    },
    onStreamError: (callback: (error: string) => void) => {
        ipcRenderer.on('copilot:stream-error', (_event, error) => callback(error));
    },
    onAskUser: (callback: (questions: any[]) => void) => {
        ipcRenderer.on('copilot:ask-user', (_event, questions) => callback(questions));
    },
    onShowAbout: (callback: () => void) => {
        ipcRenderer.on('show:about', () => callback());
    },
    
    // Zero State Event
    onZeroStateChanged: (callback: (isZeroState: boolean) => void) => {
        ipcRenderer.on('tab:zero-state', (_event, isZeroState) => callback(isZeroState));
    },

    // Remove listeners
    removeAllListeners: (channel: string) => {
        ipcRenderer.removeAllListeners(channel);
    },
});

// Type declarations for window
declare global {
    interface Window {
        electronAPI: {
            minimize: () => void;
            maximize: () => void;
            close: () => void;
            isMaximized: () => Promise<boolean>;
            navigate: (url: string) => void;
            goBack: () => void;
            goForward: () => void;
            reload: () => void;
            stop: () => void;
            newTab: (url?: string) => void;
            closeTab: (id: string) => void;
            selectTab: (id: string) => void;
            getAllTabs: () => Promise<Tab[]>;
            getActiveTab: () => Promise<Tab | null>;
            setSidebarVisible: (visible: boolean) => void;
            initCopilot: () => Promise<boolean>;
            sendMessage: (message: string, model?: string) => Promise<string>;
            getModels: () => Promise<{ id: string; name: string }[]>;
            getPageContent: () => Promise<{ title: string; url: string; content: string } | null>;
            searchWeb: (query: string) => Promise<{ success: boolean; url: string }>;
            startStream: (message: string, model?: string) => void;
            abortStream: () => void;
            sendAnswer: (answers: any) => Promise<boolean>;
            getSetting: (key: string) => Promise<unknown>;
            setSetting: (key: string, value: unknown) => Promise<boolean>;
            getTheme: () => Promise<string>;
            setTheme: (theme: string) => void;
            openExternal: (url: string) => void;
            copyToClipboard: (text: string) => void;
            onTabCreated: (callback: (tab: Tab) => void) => void;
            onTabClosed: (callback: (id: string) => void) => void;
            onTabSelected: (callback: (id: string) => void) => void;
            onTabLoading: (callback: (id: string, isLoading: boolean) => void) => void;
            onTabTitleUpdated: (callback: (id: string, title: string) => void) => void;
            onTabFaviconUpdated: (callback: (id: string, favicon: string) => void) => void;
            onTabUrlChanged: (callback: (id: string, url: string) => void) => void;
            onTabNavigationState: (callback: (id: string, state: { canGoBack: boolean; canGoForward: boolean }) => void) => void;
            onThemeChanged: (callback: (theme: string) => void) => void;
            onStreamChunk: (callback: (chunk: string) => void) => void;
            onStreamEnd: (callback: (result: string) => void) => void;
            onStreamError: (callback: (error: string) => void) => void;
            onAskUser: (callback: (questions: any[]) => void) => void;
            onShowAbout: (callback: () => void) => void;
            removeAllListeners: (channel: string) => void;
        };
    }

    interface Tab {
        id: string;
        title: string;
        url: string;
        favicon?: string;
        isLoading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
    }
}
