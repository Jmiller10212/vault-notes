import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, UpdateStatus, VaultSnapshot } from './shared.js';

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>
  },
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:getStatus') as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateStatus>,
    download: () => ipcRenderer.invoke('updates:download') as Promise<UpdateStatus>,
    install: () => ipcRenderer.invoke('updates:install') as Promise<UpdateStatus>,
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
      ipcRenderer.on('updates:status', listener);
      return () => ipcRenderer.removeListener('updates:status', listener);
    }
  },
  vault: {
    openVault: () => ipcRenderer.invoke('vault:open') as Promise<string | null>,
    snapshot: () => ipcRenderer.invoke('vault:snapshot') as Promise<VaultSnapshot>,
    readNote: (notePath: string) => ipcRenderer.invoke('vault:readNote', notePath) as Promise<string>,
    writeNote: (notePath: string, content: string) => ipcRenderer.invoke('vault:writeNote', notePath, content) as Promise<boolean>,
    createNote: (parentPath: string, title: string) => ipcRenderer.invoke('vault:createNote', parentPath, title) as Promise<string>,
    createFolder: (parentPath: string, folderName: string) => ipcRenderer.invoke('vault:createFolder', parentPath, folderName) as Promise<string>,
    rename: (itemPath: string, nextName: string) => ipcRenderer.invoke('vault:rename', itemPath, nextName) as Promise<string>,
    delete: (itemPath: string) => ipcRenderer.invoke('vault:delete', itemPath) as Promise<boolean>,
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('vault:changed', listener);
      return () => ipcRenderer.removeListener('vault:changed', listener);
    }
  }
};

contextBridge.exposeInMainWorld('notesApi', api);

export type NotesApi = typeof api;
