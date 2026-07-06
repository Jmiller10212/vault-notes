export type VaultNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: VaultNode[];
};

export type NoteMeta = {
  path: string;
  name: string;
  title: string;
  tags: string[];
  links: string[];
  excerpt: string;
  updatedAt: number;
};

export type VaultSnapshot = {
  vaultPath: string | null;
  tree: VaultNode[];
  notes: NoteMeta[];
};

export type AppSettings = {
  vaultPath: string | null;
  editorMode: 'codemirror' | 'textarea';
  splitPreview: boolean;
  theme: 'soft-dark' | 'midnight' | 'paper';
};

export type UpdateStatus = {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';
  message: string;
  version?: string;
  percent?: number;
  isPackaged: boolean;
};

export type NotesApi = {
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  };
  updates: {
    getStatus: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    download: () => Promise<UpdateStatus>;
    install: () => Promise<UpdateStatus>;
    onStatus: (callback: (status: UpdateStatus) => void) => () => void;
  };
  vault: {
    openVault: () => Promise<string | null>;
    snapshot: () => Promise<VaultSnapshot>;
    readNote: (notePath: string) => Promise<string>;
    writeNote: (notePath: string, content: string) => Promise<boolean>;
    createNote: (parentPath: string, title: string) => Promise<string>;
    createFolder: (parentPath: string, folderName: string) => Promise<string>;
    rename: (itemPath: string, nextName: string) => Promise<string>;
    delete: (itemPath: string) => Promise<boolean>;
    onChanged: (callback: () => void) => () => void;
  };
};

declare global {
  interface Window {
    notesApi: NotesApi;
  }
}
