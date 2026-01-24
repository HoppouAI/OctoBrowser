/**
 * OctoBrowser - Renderer Application Logic
 */

// State
const state = {
    tabs: [],
    activeTabId: null,
    sidebarVisible: true,
    currentTheme: 'system',
    copilotReady: false,
    isStreaming: false,
    currentModel: 'gpt-4.1',
    includePageContent: false,
    currentSessionId: null,
    messages: [], // Store messages in memory
};

// DOM Elements
const elements = {
    // Window controls
    minimizeBtn: document.getElementById('minimize-btn'),
    maximizeBtn: document.getElementById('maximize-btn'),
    closeBtn: document.getElementById('close-btn'),
    
    // Tabs
    tabsContainer: document.getElementById('tabs-container'),
    newTabBtn: document.getElementById('new-tab-btn'),
    
    // Navigation
    backBtn: document.getElementById('back-btn'),
    forwardBtn: document.getElementById('forward-btn'),
    reloadBtn: document.getElementById('reload-btn'),
    urlInput: document.getElementById('url-input'),
    
    // Sidebar
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebar: document.getElementById('copilot-sidebar'),
    sidebarResizer: document.getElementById('sidebar-resizer'),
    modelSelect: document.getElementById('model-select'),
    clearChatBtn: document.getElementById('clear-chat-btn'),
    historyBtn: document.getElementById('history-btn'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    sendBtn: document.getElementById('send-btn'),
    getPageBtn: document.getElementById('get-page-btn'),
    customScrollbar: document.getElementById('custom-scrollbar'),
    
    // Theme
    themeToggle: document.getElementById('theme-toggle'),
    themeIconLight: document.getElementById('theme-icon-light'),
    themeIconDark: document.getElementById('theme-icon-dark'),
    
    // Modal
    aboutModal: document.getElementById('about-modal'),
    historyModal: document.getElementById('history-modal'),
    historyList: document.getElementById('history-list'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),

    // Settings
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    ublockToggle: document.getElementById('ublock-toggle'),
};

// Initialize
async function init() {
    setupEventListeners();
    setupIpcListeners();
    setupResizeObserver();
    await loadSettings();
    await loadExistingTabs();
    await initializeCopilot();
}

// Load existing tabs from main process
async function loadExistingTabs() {
    try {
        const tabs = await window.electronAPI.getAllTabs();
        if (tabs && tabs.length > 0) {
            state.tabs = tabs;
            const activeTab = await window.electronAPI.getActiveTab();
            if (activeTab) {
                state.activeTabId = activeTab.id;
                elements.urlInput.value = activeTab.url || '';
            }
            renderTabs();
        } else {
            // Force zero state if no tabs loaded
            const zeroStateEl = document.getElementById('zero-state');
            const urlInput = document.getElementById('url-input');
            
            if (zeroStateEl) {
                zeroStateEl.classList.remove('hidden');
                
                // Reset state
                state.activeTabId = null;
                elements.tabsContainer.innerHTML = '';
                
                if (urlInput) {
                    urlInput.disabled = false;
                    urlInput.value = '';
                    urlInput.placeholder = 'Search or enter URL';
                }
            }
        }
    } catch (error) {
        console.error('Failed to load existing tabs:', error);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Window controls
    elements.minimizeBtn.addEventListener('click', () => window.electronAPI.minimize());
    elements.maximizeBtn.addEventListener('click', () => window.electronAPI.maximize());
    elements.closeBtn.addEventListener('click', () => window.electronAPI.close());
    
    // Tabs
    elements.newTabBtn.addEventListener('click', () => window.electronAPI.newTab());

    // Navigation
    elements.backBtn.addEventListener('click', () => window.electronAPI.goBack());
    elements.forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
    elements.reloadBtn.addEventListener('click', () => window.electronAPI.reload());
    
    elements.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            window.electronAPI.navigate(elements.urlInput.value);
            elements.urlInput.blur();
        }
    });
    
    elements.urlInput.addEventListener('focus', () => {
        elements.urlInput.select();
    });
    
    // Chat Listeners (Setup these first to ensure core functionality)
    if (elements.chatInput && elements.sendBtn) {
        elements.chatInput.addEventListener('input', () => {
            autoResizeTextarea(elements.chatInput);
            if (!state.isStreaming) {
                elements.sendBtn.disabled = !elements.chatInput.value.trim();
            }
        });
        
        elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Prevent default new line
                e.preventDefault();
                // Only send if not empty
                if (elements.chatInput.value.trim()) {
                    sendMessage();
                }
            }
        });
        
        elements.sendBtn.addEventListener('click', sendMessage);
    }
    
    if (elements.getPageBtn) {
        elements.getPageBtn.addEventListener('click', togglePageContent);
    }
    
    // Sidebar
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    
    if (elements.clearChatBtn) {
        elements.clearChatBtn.addEventListener('click', () => startNewChat());
    }
    
    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('click', showHistoryModal);
    }
    
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', showSettingsModal);
    }
    
    // Initialize resize logic safely
    initSidebarResize();
    
    if (elements.modelSelect) {
        elements.modelSelect.addEventListener('change', (e) => {
            state.currentModel = e.target.value;
            window.electronAPI.setSetting('selectedModel', state.currentModel);
        });
    }

    // Custom Scrollbar Logic (Reading Progress Style)
    if (elements.customScrollbar && elements.chatMessages) {
        elements.chatMessages.addEventListener('scroll', () => {
            const el = elements.chatMessages;
            const scroll = el.scrollTop;
            const height = el.scrollHeight - el.clientHeight;
            
            // Prevent divide by zero if no scroll
            if (height <= 0) return;
            
            let scrolled = (scroll / height) * 100;
            
            // Cap at 100
            if (scrolled > 100) scrolled = 100;
            if (scrolled < 0) scrolled = 0;

            if (scrolled <= 1) {
                elements.customScrollbar.style.height = "2%"; // Minimum visible
            } else {
                elements.customScrollbar.style.height = scrolled + "%";
            }
            
            // Glow effect when reaching bottom
            if (scrolled >= 99) {
                elements.customScrollbar.classList.add("glow");
            } else {
                elements.customScrollbar.classList.remove("glow");
            }
        });
    }
    
    // Quick actions
    document.querySelectorAll('.quick-action').forEach(btn => {
        btn.addEventListener('click', () => {
            elements.chatInput.value = btn.dataset.prompt;
            autoResizeTextarea(elements.chatInput);
            elements.sendBtn.disabled = false;
            elements.chatInput.focus();
        });
    });
    
    // Theme toggle
    elements.themeToggle.addEventListener('click', toggleTheme);
    
    // Modal
    elements.aboutModal.querySelector('.modal-overlay').addEventListener('click', closeAboutModal);
    elements.aboutModal.querySelector('.modal-close').addEventListener('click', closeAboutModal);

    elements.historyModal.querySelector('.modal-overlay').addEventListener('click', closeHistoryModal);
    elements.historyModal.querySelector('.modal-close').addEventListener('click', closeHistoryModal);
    elements.clearHistoryBtn.addEventListener('click', clearAllHistory);

    // Settings Modal
    if (elements.settingsModal) {
        elements.settingsModal.querySelector('.modal-overlay').addEventListener('click', closeSettingsModal);
        elements.settingsModal.querySelector('.modal-close').addEventListener('click', closeSettingsModal);
        
        if (elements.ublockToggle) {
            elements.ublockToggle.addEventListener('change', (e) => {
                window.electronAPI.setSetting('ublockEnabled', e.target.checked);
            });
        }
    }
    
    // Zero State Action
    const zeroNewTabBtn = document.getElementById('zero-new-tab-btn');
    if (zeroNewTabBtn) {
        zeroNewTabBtn.addEventListener('click', () => window.electronAPI.newTab());
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 't':
                    e.preventDefault();
                    window.electronAPI.newTab();
                    break;
                case 'w':
                    e.preventDefault();
                    if (state.activeTabId) {
                        window.electronAPI.closeTab(state.activeTabId);
                    }
                    break;
                case 'shift+t': // This won't match, need checking e.shiftKey
                    break;
                case 'l':
                    e.preventDefault();
                    elements.urlInput.focus();
                    break;
                case 'r':
                    e.preventDefault();
                    window.electronAPI.reload();
                    break;
            }
        }
        
        // Handle Ctrl+Shift+T manually
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
            e.preventDefault();
            window.electronAPI.restoreTab();
        }
    });

    setupContextMenu();
}

function setupContextMenu() {
    // Global context menu (title bar)
    document.getElementById('title-bar').addEventListener('contextmenu', (e) => {
        // Check if we clicked on a tab
        const tabEl = e.target.closest('.tab');

        
        if (tabEl) {
            const tabId = tabEl.dataset.id;
            window.electronAPI.showTabContextMenu({
                tabId,
                x: e.clientX,
                y: e.clientY
            });
        } else {
            // General title bar context
            window.electronAPI.showTabContextMenu({
                x: e.clientX,
                y: e.clientY
            });
        }
    });
}

// Setup IPC listeners
function setupIpcListeners() {
    window.electronAPI.onTabCreated((tab) => {
        state.tabs.push(tab);
        renderTabs();
    });
    
    window.electronAPI.onTabClosed((id) => {
        state.tabs = state.tabs.filter(t => t.id !== id);
        renderTabs();
    });
    
    window.electronAPI.onTabSelected((id) => {
        state.activeTabId = id;
        updateActiveTab();
    });
    
    window.electronAPI.onTabLoading((id, isLoading) => {
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
            tab.isLoading = isLoading;
            renderTabs();
        }
    });
    
    window.electronAPI.onTabTitleUpdated((id, title) => {
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
            tab.title = title;
            renderTabs();
        }
    });
    
    window.electronAPI.onTabFaviconUpdated((id, favicon) => {
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
            tab.favicon = favicon;
            renderTabs();
        }
    });
    
    window.electronAPI.onTabUrlChanged((id, url) => {
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
            tab.url = url;
            if (id === state.activeTabId) {
                elements.urlInput.value = url;
            }
        }
    });
    
    window.electronAPI.onTabNavigationState((id, navState) => {
        if (id === state.activeTabId) {
            elements.backBtn.disabled = !navState.canGoBack;
            elements.forwardBtn.disabled = !navState.canGoForward;
        }
    });
    
    window.electronAPI.onThemeChanged((theme) => {
        applyTheme(theme);
    });
    
    window.electronAPI.onStreamEvent((event) => {
        handleStreamEvent(event);
    });
    
    window.electronAPI.onStreamEnd((result) => {
        state.isStreaming = false;
        updateSendButton();
        
        // Check if we have a streaming message BEFORE removing the indicator/attribute
        const streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
        
        removeThinkingIndicator();
        
        // If no streaming message was created (no content received), show a fallback
        if (!streamingMessage && result) {
            const assistantMsg = { role: 'assistant', content: result, timestamp: Date.now() };
            state.messages.push(assistantMsg);
            addMessage('assistant', result, false);
        } else if (streamingMessage) {
            // Save the streamed content
            // We need to extract the full text from the DOM elements because it came in chunks
            const textBlocks = streamingMessage.querySelectorAll('.message-text');
            let fullText = '';
            textBlocks.forEach(block => fullText += block.getAttribute('data-raw') || '');
            
            const assistantMsg = { role: 'assistant', content: fullText, timestamp: Date.now() };
            state.messages.push(assistantMsg);
        }
        
        saveCurrentSession();
    });
    
    window.electronAPI.onStreamError((error) => {
        state.isStreaming = false;
        updateSendButton();
        removeThinkingIndicator();
        addErrorMessage(error);
    });
    
    window.electronAPI.onShowAbout(() => {
        showAboutModal();
    });

    // Handle Zero State visibility
    window.electronAPI.onZeroStateChanged((isZeroState) => {
        const zeroStateEl = document.getElementById('zero-state');
        const urlInput = document.getElementById('url-input');
        
        if (isZeroState) {
            zeroStateEl.classList.remove('hidden');
            state.activeTabId = null;
            elements.tabsContainer.innerHTML = '';
            urlInput.disabled = false;
            urlInput.value = '';
            urlInput.placeholder = 'Search or enter URL';
        } else {
            zeroStateEl.classList.add('hidden');
            urlInput.disabled = false;
            urlInput.placeholder = 'Search or enter URL';
        }
    });

    // Also check initial state if needed (renderer might load after tabs created)
    // We rely on "loadExistingTabs" in init usually.
}

// Load settings
async function loadSettings() {
    try {
        const theme = await window.electronAPI.getTheme();
        state.currentTheme = theme || 'system';
        applyTheme(state.currentTheme);
        
        const sidebarVisible = await window.electronAPI.getSetting('sidebarVisible');
        if (sidebarVisible !== undefined) {
            state.sidebarVisible = sidebarVisible;
        }
        updateSidebarVisibility();
        window.electronAPI.setSidebarVisible(state.sidebarVisible);
        
        const sidebarWidth = await window.electronAPI.getSetting('sidebarWidth');
        if (sidebarWidth) {
            document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
        }

        const selectedModel = await window.electronAPI.getSetting('selectedModel');
        if (selectedModel) {
            state.currentModel = selectedModel;
            elements.modelSelect.value = selectedModel;
        }

        const ublockEnabled = await window.electronAPI.getSetting('ublockEnabled');
        if (elements.ublockToggle) {
            // Default to true if undefined
            elements.ublockToggle.checked = ublockEnabled !== false;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Initialize Copilot
async function initializeCopilot() {
    try {
        const ready = await window.electronAPI.initCopilot();
        state.copilotReady = ready;
        
        if (ready) {
            // Load available models
            const models = await window.electronAPI.getModels();
            if (models && models.length > 0) {
                elements.modelSelect.innerHTML = '';
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    if (model.id === state.currentModel) {
                        option.selected = true;
                    }
                    elements.modelSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Failed to initialize Copilot:', error);
        addErrorMessage('Failed to connect to Copilot. Please check that GitHub Copilot CLI is installed.');
    }
}

// Tab rendering
function renderTabs() {
    elements.tabsContainer.innerHTML = '';
    
    state.tabs.forEach(tab => {
        const tabEl = document.createElement('div');
        tabEl.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
        tabEl.dataset.id = tab.id;
        
        // Favicon
        const favicon = document.createElement('div');
        favicon.className = 'tab-favicon';
        
        if (tab.isLoading) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'tab-loading';
            favicon.appendChild(loadingDiv);
        } else if (tab.favicon) {
            const img = document.createElement('img');
            img.alt = '';
            // Set src via DOM property (safer than building HTML) and handle errors
            img.src = tab.favicon;
            img.addEventListener('error', () => {
                favicon.innerHTML = getDefaultFaviconSvg();
            });
            favicon.appendChild(img);
        } else {
            favicon.innerHTML = getDefaultFaviconSvg();
        }
        
        // Title
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || 'New Tab';
        title.title = tab.title || 'New Tab';
        
        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10"><path fill="currentColor" d="M1.41 0L0 1.41 4.59 6 0 10.59 1.41 12 6 7.41 10.59 12 12 10.59 7.41 6 12 1.41 10.59 0 6 4.59z"></path></svg>';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.closeTab(tab.id);
        });
        
        tabEl.appendChild(favicon);
        tabEl.appendChild(title);
        tabEl.appendChild(closeBtn);
        
        // Tooltip for tab
        tabEl.title = tab.title || 'New Tab';
        
        tabEl.addEventListener('click', () => {
            window.electronAPI.selectTab(tab.id);
        });
        
        elements.tabsContainer.appendChild(tabEl);
    });
}

function updateActiveTab() {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (tab) {
        elements.urlInput.value = tab.url || '';
    }
    renderTabs();
}

// Sidebar functions
function toggleSidebar() {
    state.sidebarVisible = !state.sidebarVisible;
    updateSidebarVisibility();
    window.electronAPI.setSetting('sidebarVisible', state.sidebarVisible);
    window.electronAPI.setSidebarVisible(state.sidebarVisible);
}

function updateSidebarVisibility() {
    if (state.sidebarVisible) {
        elements.sidebar.classList.remove('collapsed');
        elements.sidebarToggle.classList.add('active');
    } else {
        elements.sidebar.classList.add('collapsed');
        elements.sidebarToggle.classList.remove('active');
    }
}

// Chat functions
async function sendMessage() {
    const message = elements.chatInput.value.trim();
    
    // If already streaming, abort instead of sending
    if (state.isStreaming) {
        window.electronAPI.abortStream();
        state.isStreaming = false;
        updateSendButton();
        removeThinkingIndicator();
        return;
    }
    
    if (!message) return;
    
    let fullMessage = message;
    
    // Include page content if requested
    if (state.includePageContent) {
        try {
            const pageContent = await window.electronAPI.getPageContent();
            if (pageContent) {
                fullMessage = `[Context: The user is viewing a page titled "${pageContent.title}" at ${pageContent.url}]\n\nPage content:\n${pageContent.content.substring(0, 5000)}\n\nUser question: ${message}`;
            }
        } catch (error) {
            console.error('Failed to get page content:', error);
        }
        state.includePageContent = false;
        elements.getPageBtn.classList.remove('active');
    }
    
    // Clear welcome message if it's the first message
    const welcomeMsg = elements.chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
        // Start new session
        startNewSession();
    } else if (!state.currentSessionId) {
        startNewSession();
    }
    
    // Add user message
    const userMessage = { role: 'user', content: message, timestamp: Date.now() };
    state.messages.push(userMessage);
    addMessage(userMessage.role, userMessage.content);
    saveCurrentSession();
    
    // Clear input
    elements.chatInput.value = '';
    autoResizeTextarea(elements.chatInput);
    elements.sendBtn.disabled = true;
    
    // Add thinking indicator
    addThinkingIndicator();
    
    // Start streaming
    state.isStreaming = true;
    updateSendButton();
    
    // Send to Copilot
    window.electronAPI.startStream(fullMessage, state.currentModel);
}

function startNewSession() {
    state.currentSessionId = Date.now().toString();
    state.messages = [];
}

function saveCurrentSession() {
    if (!state.currentSessionId || state.messages.length === 0) return;
    
    const lastMsg = state.messages[state.messages.length - 1];
    const preview = lastMsg.content.substring(0, 60) + (lastMsg.content.length > 60 ? '...' : '');
    
    // Generate title from first user message, or use generic
    let title = 'New Chat';
    const firstUserMsg = state.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
        title = firstUserMsg.content.substring(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '');
    }

    const session = {
        id: state.currentSessionId,
        title: title,
        preview: preview,
        timestamp: Date.now(),
        model: state.currentModel,
        messages: state.messages
    };
    
    window.electronAPI.saveSession(session);
}

// Update handleStreamEvent to save assistant messages
function handleStreamEvent(event) {
    if (event.type === 'content') {
        appendToLastMessage(event.data);
    } else if (event.type === 'thinking_delta') {
        updateThinkingBlock(event.data);
    } else if (event.type === 'tool_start') {
        createToolBlock(event.data.id, event.data.name);
    } else if (event.type === 'tool_end') {
        completeToolBlock(event.data.id, event.data.result);
    }
}

function updateSendButton() {
    if (state.isStreaming) {
        // Show stop icon
        elements.sendBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"></rect></svg>';
        elements.sendBtn.disabled = false;
        elements.sendBtn.classList.add('stop');
        elements.sendBtn.title = 'Stop generating';
    } else {
        // Show send icon
        elements.sendBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M.989 8 .064 2.68a1.341 1.341 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.341 1.341 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8Z"></path></svg>';
        elements.sendBtn.disabled = !elements.chatInput.value.trim();
        elements.sendBtn.classList.remove('stop');
        elements.sendBtn.title = 'Send message';
    }
}

function addMessage(role, content, isStreaming = false) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.dataset.role = role;
    if (isStreaming) {
        messageEl.dataset.streaming = 'true';
    }
    
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}`;
    // Use sparkle/copilot icon for assistant, user initial for user
    if (role === 'user') {
        avatar.innerHTML = 'U';
    } else {
        // Copilot sparkle icon
        avatar.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484C2.875 1.452 3.91 1 5.159 1c.894 0 1.724.237 2.383.674C8.152 1.248 8.967 1 9.9 1c1.255 0 2.251.452 2.907 1.293.578.715.678 1.614.678 2.484 0 .572-.053 1.148-.254 1.656.066.228.097.43.126.612.012.076.023.148.036.218.911.379 1.503 1.437 1.588 2.065v1.948c-.127.836-3.438 3.759-7.983 3.759zM3.85 6.15c-.175.606-.26 1.237-.261 1.848v1.166c0 .458.096.866.328 1.183.227.316.57.53 1.01.619.232.046.405.246.389.478-.015.232-.202.418-.435.418h-.069a2.52 2.52 0 01-.315-.069 2.47 2.47 0 01-1.59-.998 3.025 3.025 0 01-.462-1.631V7.998c.001-.644.092-1.312.276-1.948.126-.44.296-.844.5-1.2.123-.212.254-.407.391-.576.137-.168.283-.31.422-.403a.437.437 0 01.466.05c.15.116.175.332.047.489a3.95 3.95 0 00-.697 1.74zm8.3 0a3.95 3.95 0 00-.697-1.74.363.363 0 01.047-.489.437.437 0 01.466-.05c.139.093.285.235.422.403.137.169.268.364.391.576.204.356.374.76.5 1.2.184.636.275 1.304.276 1.948v1.166c0 .56-.155 1.119-.462 1.631a2.47 2.47 0 01-1.59.998 2.52 2.52 0 01-.315.069h-.069c-.233 0-.42-.186-.435-.418-.016-.232.157-.432.389-.478.44-.089.783-.303 1.01-.619.232-.317.328-.725.328-1.183V7.998c-.001-.611-.086-1.242-.261-1.848z"></path></svg>';
    }
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'Model';
    
    // Container for mixed content blocks (text, tools, thoughts)
    const messageBlocks = document.createElement('div');
    messageBlocks.className = 'message-blocks';
    
    if (content) {
        const textBlock = document.createElement('div');
        textBlock.className = 'message-text';
        textBlock.innerHTML = formatMarkdown(content);
        textBlock.setAttribute('data-raw', content);
        messageBlocks.appendChild(textBlock);
    }
    
    contentWrapper.appendChild(roleLabel);
    contentWrapper.appendChild(messageBlocks);
    
    messageEl.appendChild(avatar);
    messageEl.appendChild(contentWrapper);
    
    elements.chatMessages.appendChild(messageEl);
    scrollToBottom();
}

function clearChat() {
    elements.chatMessages.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-icon">
                <svg viewBox="0 0 16 16" width="48" height="48" fill="currentColor">
                    <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
            </div>
            <h2>How can I help you?</h2>
            <p>I can help you browse the web, answer questions, and summarize content.</p>
            <div class="quick-actions">
                <button class="quick-action" data-prompt="Summarize this page">Summarize page</button>
                <button class="quick-action" data-prompt="Search for the latest tech news">Search tech news</button>
                <button class="quick-action" data-prompt="What can you help me with?">What can you do?</button>
            </div>
        </div>
    `;
    
    // Re-attach event listeners to quick actions
    document.querySelectorAll('.quick-action').forEach(btn => {
        btn.addEventListener('click', () => {
            elements.chatInput.value = btn.dataset.prompt;
            autoResizeTextarea(elements.chatInput);
            elements.sendBtn.disabled = false;
            elements.chatInput.focus();
        });
    });
}

function updateThinkingBlock(chunk) {
    // Ensure we are in streaming mode but don't close the stream
    removeThinkingIndicator(false);

    let streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    if (!streamingMessage) {
        addMessage('assistant', '', true);
        streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    }

    const blocksContainer = streamingMessage.querySelector('.message-blocks');
    let thinkingBlock = blocksContainer.querySelector('.status-block.thinking');

    if (!thinkingBlock) {
        thinkingBlock = document.createElement('div');
        thinkingBlock.className = 'status-block thinking expanded';
        thinkingBlock.innerHTML = `
            <div class="status-header" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="status-icon">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>
                </div>
                <div class="status-title">Thinking...</div>
                <svg class="status-chevron" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>
            </div>
            <div class="status-content"></div>
        `;
        // Insert before any text content
        const firstText = blocksContainer.querySelector('.message-text');
        if (firstText) {
            blocksContainer.insertBefore(thinkingBlock, firstText);
        } else {
            blocksContainer.prepend(thinkingBlock);
        }
    }

    const contentDiv = thinkingBlock.querySelector('.status-content');
    const currentText = contentDiv.getAttribute('data-raw') || '';
    const newText = currentText + chunk;
    contentDiv.setAttribute('data-raw', newText);
    contentDiv.textContent = newText;
    
    // Always keep expanded while streaming thinking
    thinkingBlock.classList.add('expanded');
    scrollToBottom();
}

function createToolBlock(id, name) {
    removeThinkingIndicator(false);
    let streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    if (!streamingMessage) {
        addMessage('assistant', '', true);
        streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    }
    
    // Check if tool block already exists
    if (document.getElementById(`tool-${id}`)) return;
    
    const blocksContainer = streamingMessage.querySelector('.message-blocks');
    
    const block = document.createElement('div');
    block.className = 'status-block tool expanded';
    block.id = `tool-${id}`;
    block.innerHTML = `
        <div class="status-header" onclick="this.parentElement.classList.toggle('expanded')">
            <div class="status-icon spinning">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>
            </div>
            <div class="status-title">Using ${escapeHtml(name)}...</div>
            <svg class="status-chevron" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>
        </div>
        <div class="status-content">Processing request...</div>
    `;
    blocksContainer.appendChild(block);
    scrollToBottom();
}

function completeToolBlock(id, result) {
    const block = document.getElementById(`tool-${id}`);
    if (block) {
        block.classList.remove('expanded');
        block.classList.add('completed');
        const title = block.querySelector('.status-title');
        
        if (result) {
            // Use the result text if available, truncating simply for the title
            let displayResult = result;
            // Clean up standard prefixes if present in result to keep it short
            // e.g. "Found 5 match(es) for..."
            
            if (displayResult.length > 60) {
                displayResult = displayResult.substring(0, 60) + '...';
            }
            title.textContent = displayResult;
            
            // Update the detailed content with full result
            const content = block.querySelector('.status-content');
            content.textContent = result;
        } else {
            title.textContent = title.textContent.replace('Using', 'Used');
        }
        
        const icon = block.querySelector('.status-icon');
        icon.classList.remove('spinning');
        icon.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
    }
}

function appendToLastMessage(chunk) {
    // Remove individual chunk indicator if present, but DO NOT close stream
    removeThinkingIndicator(false);
    
    let streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    
    // If no streaming message exists, create one now (on first chunk)
    if (!streamingMessage) {
        addMessage('assistant', '', true);
        streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    }
    
    if (streamingMessage) {
        const blocksContainer = streamingMessage.querySelector('.message-blocks');
        let lastBlock = blocksContainer.lastElementChild;
        
        // Ensure we have a text block at the end (create one if last is a status block or missing)
        if (!lastBlock || !lastBlock.classList.contains('message-text')) {
            lastBlock = document.createElement('div');
            lastBlock.className = 'message-text';
            blocksContainer.appendChild(lastBlock);
        }
        
        const currentText = lastBlock.getAttribute('data-raw') || '';
        const newText = currentText + chunk;
        lastBlock.setAttribute('data-raw', newText);
        lastBlock.innerHTML = formatMarkdown(newText);
        scrollToBottom();
    }
}

function addThinkingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'thinking-indicator';
    indicator.id = 'thinking-indicator';
    indicator.innerHTML = `
        <div class="thinking-avatar">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484C2.875 1.452 3.91 1 5.159 1c.894 0 1.724.237 2.383.674C8.152 1.248 8.967 1 9.9 1c1.255 0 2.251.452 2.907 1.293.578.715.678 1.614.678 2.484 0 .572-.053 1.148-.254 1.656.066.228.097.43.126.612.012.076.023.148.036.218.911.379 1.503 1.437 1.588 2.065v1.948c-.127.836-3.438 3.759-7.983 3.759zM3.85 6.15c-.175.606-.26 1.237-.261 1.848v1.166c0 .458.096.866.328 1.183.227.316.57.53 1.01.619.232.046.405.246.389.478-.015.232-.202.418-.435.418h-.069a2.52 2.52 0 01-.315-.069 2.47 2.47 0 01-1.59-.998 3.025 3.025 0 01-.462-1.631V7.998c.001-.644.092-1.312.276-1.948.126-.44.296-.844.5-1.2.123-.212.254-.407.391-.576.137-.168.283-.31.422-.403a.437.437 0 01.466.05c.15.116.175.332.047.489a3.95 3.95 0 00-.697 1.74zm8.3 0a3.95 3.95 0 00-.697-1.74.363.363 0 01.047-.489.437.437 0 01.466-.05c.139.093.285.235.422.403.137.169.268.364.391.576.204.356.374.76.5 1.2.184.636.275 1.304.276 1.948v1.166c0 .56-.155 1.119-.462 1.631a2.47 2.47 0 01-1.59.998 2.52 2.52 0 01-.315.069h-.069c-.233 0-.42-.186-.435-.418-.016-.232.157-.432.389-.478.44-.089.783-.303 1.01-.619.232-.317.328-.725.328-1.183V7.998c-.001-.611-.086-1.242-.261-1.848z"></path></svg>
        </div>
        <div class="thinking-content">
            <div class="thinking-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    elements.chatMessages.appendChild(indicator);
    scrollToBottom();
}

function removeThinkingIndicator(finishStream = true) {
    const indicator = document.getElementById('thinking-indicator');
    if (indicator) {
        indicator.remove();
    }
    
    if (finishStream) {
        // Mark streaming message as complete
        const streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
        if (streamingMessage) {
            streamingMessage.removeAttribute('data-streaming');
        }
    }
}

function addErrorMessage(error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'message error';
    errorEl.innerHTML = `
        <div class="message-avatar assistant" style="background-color: var(--danger);">!</div>
        <div class="message-content">
            <div class="message-role">Error</div>
            <div class="message-text" style="color: var(--danger);">${escapeHtml(error)}</div>
        </div>
    `;
    elements.chatMessages.appendChild(errorEl);
    scrollToBottom();
}

function startNewChat() {
    clearChat();
    startNewSession();
}

// Sidebar Resize Logic
function initSidebarResize() {
    if (!elements.sidebarResizer) return;

    let isResizing = false;
    
    elements.sidebarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.classList.add('resizing');
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        // Calculate new width (from right edge of window)
        const newWidth = window.innerWidth - e.clientX;
        
        // Constraints
        if (newWidth < 250) return;
        if (newWidth > 800) return;
        
        // Update CSS variable
        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
        
        // Notify main process for BrowserView resizing (throttled could be better but direct is responsive)
        window.electronAPI.setSidebarWidth(newWidth);
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('resizing');
            
            // Persist setting
            const width = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
            window.electronAPI.setSetting('sidebarWidth', width);
        }
    });
}

// History Functions
async function showHistoryModal() {
    elements.historyModal.classList.remove('hidden');
    window.electronAPI.setModalOpen(true);
    await loadHistory();
}

function closeHistoryModal() {
    elements.historyModal.classList.add('hidden');
    window.electronAPI.setModalOpen(false);
}

async function loadHistory() {
    const sessions = await window.electronAPI.getHistory();
    renderHistoryList(sessions);
}

function renderHistoryList(sessions) {
    elements.historyList.innerHTML = '';
    
    if (!sessions || sessions.length === 0) {
        elements.historyList.innerHTML = '<div class="empty-history"><p>No chat history yet</p></div>';
        return;
    }
    
    // Sort by timestamp desc
    const sortedSessions = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedSessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const d = new Date(session.timestamp);
        // If today, show time, else show date
        const isToday = new Date().toDateString() === d.toDateString();
        const dateDisplay = isToday 
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        
        item.innerHTML = `
            <div class="history-icon">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>
            </div>
            <div class="history-content">
                <div class="history-header">
                    <span class="history-title">${escapeHtml(session.title)}</span>
                    <span class="history-date">${dateDisplay}</span>
                </div>
                <div class="history-preview">${escapeHtml(session.preview || 'No preview')}</div>
            </div>
            <button class="history-delete-btn" title="Delete">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.75 1.75 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"></path></svg>
            </button>
        `;
        
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.history-delete-btn')) {
                loadSession(session.id);
            }
        });
        
        // Delete button
        item.querySelector('.history-delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            // Optional: Confirm dialog, but standard practice in these UIs is often direct or undo. 
            // We'll stick to direct action if user wants quick management, or add confirm.
            // User requested "closer to chat", clean.
            if (confirm('Delete this chat?')) {
                await window.electronAPI.deleteSession(session.id);
                loadHistory(); // Reload list
            }
        });
        
        elements.historyList.appendChild(item);
    });
}

async function loadSession(id) {
    const session = await window.electronAPI.loadSession(id);
    if (!session) return;
    
    // Clear current UI
    elements.chatMessages.innerHTML = '';
    
    // Set state
    state.currentSessionId = session.id;
    state.messages = session.messages || [];
    
    // Render messages
    state.messages.forEach(msg => {
        addMessage(msg.role, msg.content, false);
    });
    
    closeHistoryModal();
}

async function clearAllHistory() {
    if (confirm('Are you sure you want to delete all chat history?')) {
        await window.electronAPI.clearHistory();
        loadHistory();
    }
}

function togglePageContent() {
    state.includePageContent = !state.includePageContent;
    if (state.includePageContent) {
        elements.getPageBtn.classList.add('active');
    } else {
        elements.getPageBtn.classList.remove('active');
    }
}

// Theme functions
function toggleTheme() {
    const themes = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(state.currentTheme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    
    state.currentTheme = nextTheme;
    applyTheme(nextTheme);
    window.electronAPI.setTheme(nextTheme);
}

function applyTheme(theme) {
    let effectiveTheme = theme;
    
    if (theme === 'system') {
        effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    
    // Update theme icon
    if (effectiveTheme === 'dark') {
        elements.themeIconDark.style.display = 'none';
        elements.themeIconLight.style.display = 'block';
    } else {
        elements.themeIconDark.style.display = 'block';
        elements.themeIconLight.style.display = 'none';
    }
}

// Modal functions
function showAboutModal() {
    elements.aboutModal.classList.remove('hidden');
    window.electronAPI.setModalOpen(true);
}

function closeAboutModal() {
    elements.aboutModal.classList.add('hidden');
    window.electronAPI.setModalOpen(false);
}

// Settings Modal functions
function showSettingsModal() {
    elements.settingsModal.classList.remove('hidden');
    window.electronAPI.setModalOpen(true);
}

function closeSettingsModal() {
    elements.settingsModal.classList.add('hidden');
    window.electronAPI.setModalOpen(false);
}

// Utility functions
function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    if (!text) return '';
    
    // Escape HTML first
    let html = escapeHtml(text);
    
    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Numbered lists
    html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');
    
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    // Clean up
    html = html.replace(/<p><ul>/g, '<ul>');
    html = html.replace(/<\/ul><\/p>/g, '</ul>');
    html = html.replace(/<p><pre>/g, '<pre>');
    html = html.replace(/<\/pre><\/p>/g, '</pre>');
    
    return html;
}

function getDefaultFaviconSvg() {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>';
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.currentTheme === 'system') {
        applyTheme('system');
    }
});

// Setup resize observer for dynamic tab sizing
// No longer needed as CSS Flexbox handles tab sizing dynamically
function setupResizeObserver() {
    // Left empty intentionally or could be removed from init()
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
