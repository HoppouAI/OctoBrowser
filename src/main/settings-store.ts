/**
 * Settings Store - Persists user settings
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface Settings {
    theme: 'light' | 'dark' | 'system';
    windowBounds?: {
        width: number;
        height: number;
        x?: number;
        y?: number;
    };
    selectedModel: string;
    sidebarWidth?: number;
    sidebarVisible?: boolean;
    homepage?: string;
    searchEngine?: string;
    ublockEnabled?: boolean;
}

const defaultSettings: Settings = {
    theme: 'system',
    selectedModel: 'gpt-4.1',
    sidebarWidth: 380,
    sidebarVisible: true,
    homepage: 'https://github.com',
    searchEngine: 'google',
    ublockEnabled: true
};

export class SettingsStore {
    private settings: Settings;
    private filePath: string;

    constructor() {
        const userDataPath = app.getPath('userData');
        this.filePath = path.join(userDataPath, 'settings.json');
        this.settings = this.loadSettings();
    }

    private loadSettings(): Settings {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                return { ...defaultSettings, ...JSON.parse(data) };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return { ...defaultSettings };
    }

    private saveSettings(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    get(key: string): unknown {
        return (this.settings as unknown as Record<string, unknown>)[key];
    }

    set(key: string, value: unknown): void {
        (this.settings as unknown as Record<string, unknown>)[key] = value;
        this.saveSettings();
    }

    getAll(): Settings {
        return { ...this.settings };
    }

    reset(): void {
        this.settings = { ...defaultSettings };
        this.saveSettings();
    }
}
