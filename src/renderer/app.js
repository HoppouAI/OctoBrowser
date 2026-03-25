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
    isSending: false, // Lock to prevent double-send
    currentModel: 'gpt-4.1',
    includePageContent: false,
    currentSessionId: null,
    messages: [], // Store messages in memory
    streamGeneration: 0, // Counter to ignore stale stream results after new chat
    sessionReady: Promise.resolve(), // Resolves when backend session is ready
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

    // Questions Modal
    questionsModal: document.getElementById('questions-modal'),
    questionsContainer: document.getElementById('questions-container'),
    submitAnswersBtn: document.getElementById('submit-answers-btn'),
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

    // Window state listener for maximize/restore icon toggle
    window.electronAPI.onWindowStateChanged((state) => {
        const maximizeBtn = elements.maximizeBtn;
        const iconMaximize = maximizeBtn.querySelector('.icon-maximize');
        const iconRestore = maximizeBtn.querySelector('.icon-restore');
        
        if (state.isMaximized) {
            maximizeBtn.title = "Restore";
            if (iconMaximize) iconMaximize.style.display = 'none';
            if (iconRestore) iconRestore.style.display = 'block';
        } else {
            maximizeBtn.title = "Maximize";
            if (iconMaximize) iconMaximize.style.display = 'block';
            if (iconRestore) iconRestore.style.display = 'none';
        }
    });

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

    // Questions Modal
    if (elements.questionsModal) {
        elements.submitAnswersBtn.addEventListener('click', submitAnswers);
        // Do not allow closing via overlay click for questions - user must answer
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

    window.electronAPI.onAskUser((questions) => {
        showQuestionsModal(questions);
    });
    
    window.electronAPI.onStreamEnd((result) => {
        const expectedGeneration = state.streamGeneration;
        state.isStreaming = false;
        updateSendButton();
        
        // Ignore stale stream results from before a chat was cleared
        if (expectedGeneration !== state.streamGeneration) return;
        
        // Check if we have a streaming message BEFORE removing the indicator/attribute
        const streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
        
        removeThinkingIndicator();
        
        // If no streaming message was created (no content received), show a fallback
        if (!streamingMessage && result) {
            const assistantMsg = { id: 'asst-' + Date.now(), role: 'assistant', content: result, timestamp: Date.now() };
            state.messages.push(assistantMsg);
            addMessage('assistant', result, false, assistantMsg.id);
        } else if (streamingMessage) {
            // Save the streamed content
            // We need to extract the full structure from the DOM elements
            const messageBlocksDiv = streamingMessage.querySelector('.message-blocks');
            const childNodes = messageBlocksDiv ? Array.from(messageBlocksDiv.children) : [];
            const blocks = [];
            let fullText = '';
            
            childNodes.forEach(node => {
                if (node.classList.contains('message-text')) {
                     const text = node.getAttribute('data-raw') || '';
                     blocks.push({ type: 'text', content: text });
                     fullText += text;
                } else if (node.classList.contains('status-block')) {
                     if (node.classList.contains('thinking')) {
                         const content = node.querySelector('.status-content').getAttribute('data-raw') || '';
                         blocks.push({ type: 'thinking', content: content });
                     } else if (node.classList.contains('tool')) {
                         const name = node.dataset.name || 'Tool';
                         const result = node.querySelector('.status-content').getAttribute('data-raw') || '';
                         blocks.push({ type: 'tool', name: name, result: result });
                     }
                }
            });
            
            // Get ID from DOM if possible, otherwise generate
            const msgId = streamingMessage.dataset.id || ('asst-' + Date.now());
            // Ensure ID is set on DOM if it wasn't
            if (!streamingMessage.dataset.id) streamingMessage.dataset.id = msgId;

            const assistantMsg = { 
                id: msgId, 
                role: 'assistant', 
                content: fullText, // Plain text for previews
                blocks: blocks,    // Structured data for restoring UI
                timestamp: Date.now() 
            };
            state.messages.push(assistantMsg);
        }
        
        saveCurrentSession();
    });
    
    window.electronAPI.onStreamError((error) => {
        const expectedGen = state.streamGeneration;
        state.isStreaming = false;
        updateSendButton();
        if (expectedGen !== state.streamGeneration) return;
        removeThinkingIndicator();
        addErrorMessage(error);
    });
    
    window.electronAPI.onShowAbout(() => {
        showAboutModal();
    });

    window.electronAPI.onSidebarToggle(() => {
        toggleSidebar();
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
    
    // Prevent double-send while processing
    if (state.isSending) return;
    state.isSending = true;
    elements.sendBtn.disabled = true;
    elements.chatInput.disabled = true;
    
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
        // Keep context enabled for subsequent messages
        // state.includePageContent = false;
        // elements.getPageBtn.classList.remove('active');
    }
    
    // Clear welcome message if it's the first message
    const welcomeMsg = elements.chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
        // Only create session if one doesn't exist yet (startNewChat already created one)
        if (!state.currentSessionId) {
            await startNewSession();
        }
    } else if (!state.currentSessionId) {
        await startNewSession();
    }
    
    // Wait for any in-progress session reset to complete
    await state.sessionReady;
    
    // Add user message
    const userMessage = { id: Date.now().toString(), role: 'user', content: message, timestamp: Date.now() };
    state.messages.push(userMessage);
    addMessage(userMessage.role, userMessage.content, false, userMessage.id);
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
    
    // Unlock send
    state.isSending = false;
    elements.chatInput.disabled = false;
    elements.chatInput.focus();
    
    // Send to Copilot
    window.electronAPI.startStream(fullMessage, state.currentModel);
}

async function startNewSession() {
    state.currentSessionId = Date.now().toString();
    state.messages = [];
    
    // Track session readiness so sendMessage can wait for it
    const readyPromise = (async () => {
        try {
            await window.electronAPI.resetSession();
        } catch (err) {
            console.warn('Failed to reset Copilot session:', err);
        }
    })();
    state.sessionReady = readyPromise;
    await readyPromise;
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
        closeActiveThinkingBlock();
        appendToLastMessage(event.data);
    } else if (event.type === 'thinking_delta') {
        updateThinkingBlock(event.data);
    } else if (event.type === 'tool_start') {
        closeActiveThinkingBlock();
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

function addMessage(role, content, isStreaming = false, id = null, blocks = null) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.dataset.role = role;
    if (id) {
        messageEl.dataset.id = id;
    }
    if (isStreaming) {
        messageEl.dataset.streaming = 'true';
    }
    
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}`;
    // Use sparkle/copilot icon for assistant, user initial for user
    if (role === 'user') {
        avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
    } else {
        // Copilot logo icon
        avatar.innerHTML = '<svg viewBox="0 0 512 416" width="14" height="14" fill="currentColor"><path d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z" fill-rule="nonzero"/><path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/></svg>';
    }
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'Model';
    
    // Container for mixed content blocks (text, tools, thoughts)
    const messageBlocks = document.createElement('div');
    messageBlocks.className = 'message-blocks';
    
    if (blocks && blocks.length > 0) {
        blocks.forEach(block => {
            if (block.type === 'text') {
                 const textBlock = document.createElement('div');
                 textBlock.className = 'message-text';
                 textBlock.innerHTML = formatMarkdown(block.content);
                 textBlock.setAttribute('data-raw', block.content);
                 messageBlocks.appendChild(textBlock);
            } else if (block.type === 'thinking') {
                 const thinkingBlock = document.createElement('div');
                 thinkingBlock.className = 'status-block thinking completed'; 
                 thinkingBlock.innerHTML = `
                    <div class="status-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="status-icon"><i class="fa-solid fa-check"></i></div>
                        <div class="status-title">Finished thinking</div>
                        <svg class="status-chevron" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>
                    </div>
                    <div class="status-content" data-raw="${escapeHtml(block.content)}">${escapeHtml(block.content)}</div>
                 `;
                 messageBlocks.appendChild(thinkingBlock);
            } else if (block.type === 'tool') {
                 const toolBlock = document.createElement('div');
                 toolBlock.className = 'status-block tool completed';
                 toolBlock.dataset.name = block.name;
                 toolBlock.innerHTML = `
                    <div class="status-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="status-icon"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg></div>
                        <div class="status-title">Used ${escapeHtml(block.name)}</div>
                         <svg class="status-chevron" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>
                    </div>
                    <div class="status-content" data-raw="${escapeHtml(block.result)}">${formatMarkdown(block.result)}</div>
                 `;
                 messageBlocks.appendChild(toolBlock);
            }
        });
    } else if (content) {
        const textBlock = document.createElement('div');
        textBlock.className = 'message-text';
        textBlock.innerHTML = formatMarkdown(content);
        textBlock.setAttribute('data-raw', content);
        messageBlocks.appendChild(textBlock);
    }
    
    contentWrapper.appendChild(roleLabel);
    contentWrapper.appendChild(messageBlocks);
    
    // Add actions for assistant messages
    if (role === 'assistant') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        
        // Copy Button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn';
        copyBtn.title = 'Copy response';
        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
        
        copyBtn.addEventListener('click', () => {
             const textBlocks = messageBlocks.querySelectorAll('.message-text');
             let fullText = '';
             textBlocks.forEach(block => fullText += block.getAttribute('data-raw') || '');
             
             if (!fullText) {
                 fullText = messageBlocks.innerText;
             }
             
             window.electronAPI.copyToClipboard(fullText);
             
             const originalIcon = copyBtn.innerHTML;
             copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
             copyBtn.classList.add('success');
             setTimeout(() => {
                 copyBtn.innerHTML = originalIcon;
                 copyBtn.classList.remove('success');
             }, 2000);
        });
        
        // Retry/Rerun Button
        const retryBtn = document.createElement('button');
        retryBtn.className = 'action-btn';
        retryBtn.title = 'Rerun prompt';
        retryBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i>';
        
        retryBtn.addEventListener('click', () => {
            let prev = messageEl.previousElementSibling;
            while(prev && prev.dataset.role !== 'user') {
                prev = prev.previousElementSibling;
            }
            
            if (prev) {
                const textBlock = prev.querySelector('.message-text');
                if (textBlock) {
                    const raw = textBlock.getAttribute('data-raw') || textBlock.innerText;
                    elements.chatInput.value = raw;
                    autoResizeTextarea(elements.chatInput);
                    elements.chatInput.focus();
                    
                    // Remove both messages from state and DOM
                    const currentId = messageEl.dataset.id;
                    const prevId = prev.dataset.id;
                    
                    if (currentId && prevId) {
                        state.messages = state.messages.filter(m => m.id !== currentId && m.id !== prevId);
                    } else {
                        // Fallback if IDs missing (legacy messages) - remove last 2 if these are the last 2
                        // Or just rely on DOM removal and let state drift if it's edge case
                        // But best effort to sync state:
                        // Find index of these messages? Not reliable without ID.
                        // Assuming they are at the end for simple retry:
                         if (state.messages.length >= 2) {
                             // Check if they match content roughly?
                             // Just removing from DOM is visible action. 
                             // To fix history:
                             // Reconstruct state from DOM? No.
                             // We'll just try to match by content if ID missing?
                             // For now, assume IDs are present for new messages.
                         }
                    }

                    messageEl.remove();
                    prev.remove();

                    // Automatically send
                    elements.sendBtn.disabled = false;
                    sendMessage();
                }
            }
        });
 
        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(retryBtn);
        contentWrapper.appendChild(actionsDiv);
    }
    
    messageEl.appendChild(avatar);
    messageEl.appendChild(contentWrapper);
    
    elements.chatMessages.appendChild(messageEl);
    scrollToBottom();
}

function clearChat() {
    elements.chatMessages.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-icon">
                <svg viewBox="0 0 512 416" width="48" height="39" fill="currentColor">
                    <path d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z" fill-rule="nonzero"/>
                    <path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/></svg>
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
    const lastBlock = blocksContainer.lastElementChild;
    let thinkingBlock;
    
    // Check if the last block is a thinking block we can append to
    if (lastBlock && lastBlock.classList.contains('status-block') && lastBlock.classList.contains('thinking')) {
        thinkingBlock = lastBlock;
    } else {
        // Create new thinking block at the end
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
        blocksContainer.appendChild(thinkingBlock);
    }

    const contentDiv = thinkingBlock.querySelector('.status-content');
    const currentText = contentDiv.getAttribute('data-raw') || '';
    const newText = currentText + chunk;
    contentDiv.setAttribute('data-raw', newText);
    contentDiv.textContent = newText;
    
    // Always keep expanded while streaming this specific block
    if (!thinkingBlock.classList.contains('expanded')) {
        thinkingBlock.classList.add('expanded');
    }
    
    scrollToBottom();
}

function closeActiveThinkingBlock() {
    let streamingMessage = elements.chatMessages.querySelector('[data-streaming="true"]');
    if (streamingMessage) {
        const blocksContainer = streamingMessage.querySelector('.message-blocks');
        const lastBlock = blocksContainer.lastElementChild;
        if (lastBlock && lastBlock.classList.contains('status-block') && lastBlock.classList.contains('thinking')) {
            if (!lastBlock.classList.contains('completed')) {
                lastBlock.classList.remove('expanded');
                lastBlock.classList.add('completed');
                
                const title = lastBlock.querySelector('.status-title');
                if (title) title.textContent = 'Finished thinking';
                
                const icon = lastBlock.querySelector('.status-icon');
                if (icon) {
                    icon.innerHTML = '<i class="fa-solid fa-check"></i>';
                }
            }
        }
    }
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
    block.dataset.name = name;
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
        
        let displayResult = result;
        
        // Handle images (Data URLs) - only on explicit tool result
        if (typeof result === 'string' && result.startsWith('data:image')) {
            title.textContent = 'Screenshot captured';
            const content = block.querySelector('.status-content');
            content.innerHTML = `<img src="${result}" style="max-width: 100%; border-radius: 4px; border: 1px solid var(--border-default);" alt="Screenshot">`;
            // Don't set text content if we set innerHTML
            // Also clear the spinning state and update the icon for images
            const icon = block.querySelector('.status-icon');
            icon.classList.remove('spinning');
            icon.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
            return;
        }

        if (result) {
            // Use the result text if available, truncating simply for the title
            // Clean up standard prefixes if present in result to keep it short
            // e.g. "Found 5 match(es) for..."
            
            if (displayResult.length > 60) {
                displayResult = displayResult.substring(0, 60) + '...';
            }
            title.textContent = displayResult;
            
            // Update the detailed content with full result
            const content = block.querySelector('.status-content');
            content.innerHTML = formatMarkdown(result);
            content.setAttribute('data-raw', result);
        } else {
            title.textContent = title.textContent.replace('Using', 'Used');
            // Fix: Update content so it doesn't say 'Processing request...'
            const content = block.querySelector('.status-content');
            content.textContent = 'Action completed.';
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
    // Check if one already exists to avoid duplicates
    if (document.getElementById('thinking-indicator')) return;
    
    const indicator = document.createElement('div');
    // Use message class to ensure identical padding and alignment with other messages
    indicator.className = 'message thinking-indicator';
    indicator.id = 'thinking-indicator';
    indicator.innerHTML = `
        <div class="message-avatar assistant">
            <svg viewBox="0 0 512 416" width="14" height="14" fill="currentColor"><path d="M181.33 266.143c0-11.497 9.32-20.818 20.818-20.818 11.498 0 20.819 9.321 20.819 20.818v38.373c0 11.497-9.321 20.818-20.819 20.818-11.497 0-20.818-9.32-20.818-20.818v-38.373zM308.807 245.325c-11.477 0-20.798 9.321-20.798 20.818v38.373c0 11.497 9.32 20.818 20.798 20.818 11.497 0 20.818-9.32 20.818-20.818v-38.373c0-11.497-9.32-20.818-20.818-20.818z" fill-rule="nonzero"/><path d="M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011C431.767 374.444 344.695 416 256 416c-98.138 0-196.379-56.542-246.33-93.21-5.975-4.374-9.65-11.6-9.671-19.012v-57.384a35.347 35.347 0 016.857-20.922l15.583-21.085c8.336-11.312 20.757-14.31 33.98-14.31 4.988-56.953 16.794-97.604 45.024-127.354C155.194 5.77 226.56 0 256 0c29.441 0 100.807 5.77 154.557 62.722 28.19 29.75 40.036 70.401 45.025 127.354 13.263 0 25.602 2.936 33.958 14.31l15.583 21.127c4.476 6.077 6.878 13.345 6.878 20.88zm-97.666-26.075c-.677-13.058-11.292-18.19-22.338-21.824-11.64 7.309-25.848 10.183-39.46 10.183-14.454 0-41.432-3.47-63.872-25.869-5.667-5.625-9.527-14.454-12.155-24.247a212.902 212.902 0 00-20.469-1.088c-6.098 0-13.099.349-20.551 1.088-2.628 9.793-6.509 18.622-12.155 24.247-22.4 22.4-49.418 25.87-63.872 25.87-13.612 0-27.86-2.855-39.501-10.184-11.005 3.613-21.558 8.828-22.277 21.824-1.17 24.555-1.272 49.11-1.375 73.645-.041 12.318-.082 24.658-.288 36.976.062 7.166 4.374 13.818 10.882 16.774 52.97 24.124 103.045 36.278 149.137 36.278 46.01 0 96.085-12.154 149.014-36.278 6.508-2.956 10.84-9.608 10.881-16.774.637-36.832.124-73.809-1.642-110.62h.041zM107.521 168.97c8.643 8.623 24.966 14.392 42.56 14.392 13.448 0 39.03-2.874 60.156-24.329 9.28-8.951 15.05-31.35 14.413-54.079-.657-18.231-5.769-33.28-13.448-39.665-8.315-7.371-27.203-10.574-48.33-8.644-22.399 2.238-41.267 9.588-50.875 19.833-20.798 22.728-16.323 80.317-4.476 92.492zm130.556-56.008c.637 3.51.965 7.35 1.273 11.517 0 2.875 0 5.77-.308 8.952 6.406-.636 11.847-.636 16.959-.636s10.553 0 16.959.636c-.329-3.182-.329-6.077-.329-8.952.329-4.167.657-8.007 1.294-11.517-6.735-.637-12.812-.965-17.924-.965s-11.21.328-17.924.965zm49.275-8.008c-.637 22.728 5.133 45.128 14.413 54.08 21.105 21.454 46.708 24.328 60.155 24.328 17.596 0 33.918-5.769 42.561-14.392 11.847-12.175 16.322-69.764-4.476-92.492-9.608-10.245-28.476-17.595-50.875-19.833-21.127-1.93-40.015 1.273-48.33 8.644-7.679 6.385-12.791 21.434-13.448 39.665z"/></svg>
        </div>
        <div class="message-content">
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

async function startNewChat() {
    // Abort any active stream first
    if (state.isStreaming) {
        window.electronAPI.abortStream();
        state.isStreaming = false;
        updateSendButton();
        removeThinkingIndicator();
    }
    
    // Bump generation counter so stale stream results are ignored
    state.streamGeneration++;
    
    clearChat();
    await startNewSession();
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
            if (confirm('Delete this chat?')) {
                await window.electronAPI.deleteSession(session.id);
                
                // If we deleted the active session, reset the current state
                if (state.currentSessionId === session.id) {
                    startNewChat();
                    // Ensure focus isn't lost
                    requestAnimationFrame(() => {
                        elements.chatInput.focus();
                    });
                }
                
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
        // Ensure msg has ID if legacy
        if (!msg.id) msg.id = 'msg-' + Date.now() + Math.random().toString(36).substr(2, 5);
        addMessage(msg.role, msg.content, false, msg.id, msg.blocks);
    });
    
    closeHistoryModal();
}

async function clearAllHistory() {
    if (confirm('Are you sure you want to delete all chat history?')) {
        await window.electronAPI.clearHistory();
        closeHistoryModal();
        startNewChat(); // Reset the current chat as well
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

// Question Functions
function showQuestionsModal(questions) {
    if (!questions || questions.length === 0) return;
    
    elements.questionsContainer.innerHTML = '';
    
    questions.forEach((q, index) => {
        const questionGroup = document.createElement('div');
        questionGroup.className = 'question-group';
        questionGroup.style.marginBottom = '20px';
        
        // Header
        const label = document.createElement('label');
        label.className = 'question-label';
        label.textContent = q.question;
        label.style.display = 'block';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '8px';
        questionGroup.appendChild(label);
        
        // Options
        if (q.options && q.options.length > 0) {
            // Select (multi or single)
            if (q.multiSelect) {
                // Checkboxes
                q.options.forEach((opt, optIndex) => {
                    const optDiv = document.createElement('div');
                    optDiv.className = 'option-item';
                    optDiv.style.marginBottom = '5px';
                    
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = `q${index}-opt${optIndex}`;
                    checkbox.name = `q${index}`;
                    checkbox.value = opt.label;
                    if (opt.recommended) checkbox.checked = true;
                    
                    const optLabel = document.createElement('label');
                    optLabel.htmlFor = `q${index}-opt${optIndex}`;
                    optLabel.textContent = opt.label + (opt.description ? ` - ${opt.description}` : '');
                    optLabel.style.marginLeft = '8px';
                    
                    optDiv.appendChild(checkbox);
                    optDiv.appendChild(optLabel);
                    questionGroup.appendChild(optDiv);
                });
            } else {
                // Radio buttons
                q.options.forEach((opt, optIndex) => {
                    const optDiv = document.createElement('div');
                    optDiv.className = 'option-item';
                    optDiv.style.marginBottom = '5px';
                    
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.id = `q${index}-opt${optIndex}`;
                    radio.name = `q${index}`;
                    radio.value = opt.label;
                    if (opt.recommended) radio.checked = true;
                    
                    const optLabel = document.createElement('label');
                    optLabel.htmlFor = `q${index}-opt${optIndex}`;
                    optLabel.textContent = opt.label + (opt.description ? ` - ${opt.description}` : '');
                    optLabel.style.marginLeft = '8px';
                    
                    optDiv.appendChild(radio);
                    optDiv.appendChild(optLabel);
                    questionGroup.appendChild(optDiv);
                });
            }
        } else {
            // Free text
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `q${index}-input`;
            input.name = `q${index}`;
            input.className = 'text-input';
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.borderRadius = '4px';
            input.style.border = '1px solid var(--border-color)';
            input.style.backgroundColor = 'var(--input-bg)';
            input.style.color = 'var(--text-color)';
            
            questionGroup.appendChild(input);
        }
        
        elements.questionsContainer.appendChild(questionGroup);
    });
    
    // Store original questions structure for parsing answers
    state.currentQuestions = questions;
    
    elements.questionsModal.classList.remove('hidden');
    window.electronAPI.setModalOpen(true);
}

function submitAnswers() {
    if (!state.currentQuestions) return;
    
    const answers = [];
    
    state.currentQuestions.forEach((q, index) => {
        let answer;
        
        if (q.options && q.options.length > 0) {
            if (q.multiSelect) {
                // Collect all checked
                const checked = Array.from(document.querySelectorAll(`input[name="q${index}"]:checked`));
                answer = checked.map(c => c.value);
            } else {
                // Find checked radio
                const checked = document.querySelector(`input[name="q${index}"]:checked`);
                answer = checked ? checked.value : null;
            }
        } else {
            // Text input
            const input = document.getElementById(`q${index}-input`);
            answer = input ? input.value : '';
        }
        
        // Match the format expected by the tool (usually mapped by question header/id, but simpler is array index or question text)
        // The tool returns whatever the user provides. We'll return structured objects.
        answers.push({
            question: q.question,
            answer: answer
        });
    });
    
    // Send to main process
    window.electronAPI.sendAnswer(answers);
    
    // Close modal
    elements.questionsModal.classList.add('hidden');
    window.electronAPI.setModalOpen(false);
    state.currentQuestions = null;
    
    scrollToBottom();
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
    
    // Auto-link raw URLs that haven't been processed
    // Negative lookbehind ensures we don't double-link inside href attributes or existing anchor tags
    html = html.replace(/(?<!href="|">)(https?:\/\/[^\s<]+)/g, (match) => {
        // Remove trailing punctuation commonly found at end of sentences
        const cleanMatch = match.replace(/[.,;:)]+$/, '');
        const suffix = match.substring(cleanMatch.length);
        return `<a href="${cleanMatch}" target="_blank" rel="noopener">${cleanMatch}</a>${suffix}`;
    });

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
