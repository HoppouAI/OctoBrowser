import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    preview: string; // First few words of last message
    timestamp: number;
    model: string;
    messages: ChatMessage[];
}

export class HistoryStore {
    private history: ChatSession[] = [];
    private filePath: string;

    constructor() {
        const userDataPath = app.getPath('userData');
        this.filePath = path.join(userDataPath, 'chat-history.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                this.history = JSON.parse(data);
                // Sort by newness
                this.history.sort((a, b) => b.timestamp - a.timestamp);
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
            this.history = [];
        }
    }

    private save(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.history, null, 2));
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    getSessions(): Partial<ChatSession>[] {
        // Return lightweight version for list
        return this.history.map(session => ({
            id: session.id,
            title: session.title,
            preview: session.preview,
            timestamp: session.timestamp,
            model: session.model
        }));
    }

    getSession(id: string): ChatSession | undefined {
        return this.history.find(s => s.id === id);
    }

    saveSession(session: ChatSession): void {
        const existingIndex = this.history.findIndex(s => s.id === session.id);
        if (existingIndex >= 0) {
            this.history[existingIndex] = session;
        } else {
            this.history.unshift(session);
        }
        // Keep limit (e.g., 50 chats)
        if (this.history.length > 50) {
            this.history = this.history.slice(0, 50);
        }
        this.save();
    }

    deleteSession(id: string): void {
        this.history = this.history.filter(s => s.id !== id);
        this.save();
    }

    clear(): void {
        this.history = [];
        this.save();
    }
}
