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
