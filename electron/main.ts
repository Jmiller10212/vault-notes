import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppSettings, NoteMeta, UpdateStatus, VaultNode, VaultSnapshot } from './shared.js';

type StoreShape = {
  vaultPath?: string;
  editorMode?: AppSettings['editorMode'];
  splitPreview?: boolean;
  theme?: AppSettings['theme'];
};

let mainWindow: BrowserWindow | null = null;
let watcher: AbortController | null = null;
let updateStatus: UpdateStatus = {
  phase: 'idle',
  message: 'Updates have not been checked yet.',
  isPackaged: app.isPackaged
};

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;
let storeCache: StoreShape | null = null;
const updateOwner = 'Jmiller10212';
const updateRepo = 'vault-notes';

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readStore(): StoreShape {
  if (storeCache) return storeCache;
  try {
    storeCache = JSON.parse(fsSync.readFileSync(settingsPath(), 'utf8')) as StoreShape;
  } catch {
    storeCache = {};
  }
  return storeCache;
}

function writeStore(next: StoreShape) {
  storeCache = next;
  fsSync.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fsSync.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
}

function storeGet<Key extends keyof StoreShape>(key: Key): StoreShape[Key] | undefined {
  return readStore()[key];
}

function storeSet<Key extends keyof StoreShape>(key: Key, value: StoreShape[Key]) {
  writeStore({ ...readStore(), [key]: value });
}

function getSettings(): AppSettings {
  const defaultVault = isDev ? process.cwd() : path.join(app.getPath('documents'), 'Vault Notes');
  return {
    vaultPath: storeGet('vaultPath') ?? defaultVault,
    editorMode: storeGet('editorMode') ?? 'textarea',
    splitPreview: storeGet('splitPreview') ?? true,
    theme: storeGet('theme') ?? 'soft-dark'
  };
}

function setVaultPath(vaultPath: string) {
  storeSet('vaultPath', vaultPath);
  startWatcher(vaultPath);
}

async function createWindow() {
  await ensureVaultFolder();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    title: 'Vault Notes',
    backgroundColor: '#17171c',
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    await mainWindow.loadURL(pathToFileURL(path.join(__dirname, '../dist/index.html')).toString());
  }

  startWatcher(getSettings().vaultPath ?? process.cwd());
  configureUpdater();
  setTimeout(() => void checkForUpdates(false), 2500);
}

async function ensureVaultFolder() {
  const vaultPath = getSettings().vaultPath;
  if (vaultPath) {
    await fs.mkdir(vaultPath, { recursive: true });
  }
}

function normalizeRelativePath(input: string) {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveVaultPath(relativePath = '') {
  const vaultPath = getSettings().vaultPath;
  if (!vaultPath) {
    throw new Error('No vault folder is open.');
  }

  const resolved = path.resolve(vaultPath, normalizeRelativePath(relativePath));
  const vaultRoot = path.resolve(vaultPath);
  if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
    throw new Error('Path escapes the active vault.');
  }
  return resolved;
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readVaultTree(root: string, current = root): Promise<VaultNode[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const visible = entries.filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'dist-electron');
  const nodes: Array<VaultNode | null> = await Promise.all(
    visible.map(async (entry) => {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relative,
          type: 'folder' as const,
          children: await readVaultTree(root, absolute)
        };
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        return { name: entry.name, path: relative, type: 'file' as const };
      }
      return null;
    })
  );

  return nodes
    .filter((node): node is VaultNode => Boolean(node))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function flattenFiles(nodes: VaultNode[]): VaultNode[] {
  return nodes.flatMap((node) => (node.type === 'file' ? [node] : flattenFiles(node.children ?? [])));
}

function extractFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match?.[1] ?? '';
}

function extractTags(content: string) {
  const frontmatter = extractFrontmatter(content);
  const frontmatterTags = [...frontmatter.matchAll(/tags:\s*(?:\[(.*?)\]|(.+))/gi)].flatMap((match) => {
    const raw = match[1] ?? match[2] ?? '';
    return raw.split(/[, ]+/).map((tag) => tag.replace(/^#/, '').trim());
  });
  const inlineTags = [...content.matchAll(/(?:^|\s)#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  return [...new Set([...frontmatterTags, ...inlineTags].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function extractLinks(content: string) {
  return [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].split('|')[0].trim()).filter(Boolean))];
}

function titleFromContent(fileName: string, content: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fileName.replace(/\.md$/i, '');
}

async function readNotes(root: string, tree: VaultNode[]): Promise<NoteMeta[]> {
  const files = flattenFiles(tree);
  return Promise.all(
    files.map(async (file) => {
      const absolute = path.join(root, file.path);
      const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)]);
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
      return {
        path: file.path,
        name: file.name,
        title: titleFromContent(file.name, content),
        tags: extractTags(content),
        links: extractLinks(content),
        excerpt: body.replace(/\s+/g, ' ').slice(0, 180),
        updatedAt: stat.mtimeMs
      };
    })
  );
}

async function snapshot(): Promise<VaultSnapshot> {
  const vaultPath = getSettings().vaultPath;
  if (!vaultPath || !(await pathExists(vaultPath))) {
    return { vaultPath: null, tree: [], notes: [] };
  }

  const tree = await readVaultTree(vaultPath);
  const notes = await readNotes(vaultPath, tree);
  return { vaultPath, tree, notes };
}

function startWatcher(vaultPath: string) {
  watcher?.abort();
  watcher = new AbortController();

  try {
    fsSync.watch(vaultPath, { recursive: true, signal: watcher.signal }, () => {
      mainWindow?.webContents.send('vault:changed');
    });
  } catch {
    // Recursive watching is best-effort across platforms. Manual refresh still works.
  }
}

function setUpdateStatus(patch: Omit<Partial<UpdateStatus>, 'isPackaged'>) {
  updateStatus = { ...updateStatus, ...patch, isPackaged: app.isPackaged };
  mainWindow?.webContents.send('updates:status', updateStatus);
}

function normalizeVersion(input: string) {
  return input.replace(/^v/i, '').split(/[+-]/)[0];
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function requestJson<T>(url: string, redirects = 0): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Vault-Notes-Updater'
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location && redirects < 5) {
          response.resume();
          resolve(requestJson<T>(new URL(location, url).toString(), redirects + 1));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`GitHub update check failed with HTTP ${statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error('GitHub update check timed out.'));
    });
  });
}

async function checkGitHubLatestRelease() {
  const release = await requestJson<GitHubRelease>(`https://api.github.com/repos/${updateOwner}/${updateRepo}/releases/latest`);
  if (release.draft || release.prerelease) return updateStatus;

  const latestVersion = normalizeVersion(release.tag_name);
  const currentVersion = app.getVersion();
  const installer = release.assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith('.exe') && name.includes('setup');
  });

  if (compareVersions(latestVersion, currentVersion) > 0) {
    setUpdateStatus({
      phase: 'available',
      message: `Version ${latestVersion} is available from GitHub.`,
      version: latestVersion,
      percent: undefined,
      source: 'github-api',
      releaseUrl: release.html_url,
      downloadUrl: installer?.browser_download_url ?? release.html_url
    });
  } else if (updateStatus.phase !== 'available' && updateStatus.phase !== 'downloaded' && updateStatus.phase !== 'downloading') {
    setUpdateStatus({
      phase: 'not-available',
      message: `Vault Notes is up to date at version ${currentVersion}.`,
      version: currentVersion,
      percent: undefined,
      source: 'github-api',
      releaseUrl: release.html_url,
      downloadUrl: undefined
    });
  }

  return updateStatus;
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({ phase: 'checking', message: 'Checking GitHub for updates...', percent: undefined, source: 'electron-updater' });
  });
  autoUpdater.on('update-available', (info) => {
    setUpdateStatus({
      phase: 'available',
      message: `Version ${info.version} is available.`,
      version: info.version,
      percent: undefined,
      source: 'electron-updater',
      releaseUrl: undefined,
      downloadUrl: undefined
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    setUpdateStatus({
      phase: 'not-available',
      message: `Vault Notes is up to date at version ${info.version}.`,
      version: info.version,
      percent: undefined,
      source: 'electron-updater',
      releaseUrl: undefined,
      downloadUrl: undefined
    });
    void checkGitHubLatestRelease().catch(() => undefined);
  });
  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      phase: 'downloading',
      message: `Downloading update (${Math.round(progress.percent)}%).`,
      percent: progress.percent,
      source: 'electron-updater'
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({
      phase: 'downloaded',
      message: `Version ${info.version} is ready to install.`,
      version: info.version,
      percent: 100,
      source: 'electron-updater'
    });
  });
  autoUpdater.on('error', (error) => {
    setUpdateStatus({
      phase: 'error',
      message: error.message || 'Update check failed.',
      percent: undefined,
      source: 'electron-updater'
    });
  });
}

async function checkForUpdates(userInitiated: boolean) {
  if (!app.isPackaged) {
    setUpdateStatus({
      phase: 'unsupported',
      message: 'Updates can only be checked from the installed app, not the dev build.'
    });
    return updateStatus;
  }

  setUpdateStatus({
    phase: 'checking',
    message: 'Checking GitHub for updates...',
    percent: undefined,
    source: 'electron-updater'
  });

  try {
    await autoUpdater.checkForUpdates();
    await new Promise((resolve) => {
      setTimeout(resolve, 750);
    });

    if (updateStatus.phase === 'not-available' || updateStatus.phase === 'checking') {
      await checkGitHubLatestRelease();
    }
  } catch (error) {
    try {
      await checkGitHubLatestRelease();
    } catch {
      if (userInitiated) {
        setUpdateStatus({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Update check failed.',
          source: 'electron-updater'
        });
      }
    }
  }
  return updateStatus;
}

async function downloadUpdate() {
  if (!app.isPackaged) return updateStatus;

  if (updateStatus.source === 'github-api' && (updateStatus.downloadUrl || updateStatus.releaseUrl)) {
    const url = updateStatus.downloadUrl ?? updateStatus.releaseUrl;
    if (url) await shell.openExternal(url);
    setUpdateStatus({
      message: 'Opening the GitHub installer download in your browser. Run the installer to update Vault Notes.',
      source: 'github-api'
    });
    return updateStatus;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    if (updateStatus.downloadUrl || updateStatus.releaseUrl) {
      const url = updateStatus.downloadUrl ?? updateStatus.releaseUrl;
      if (url) await shell.openExternal(url);
      setUpdateStatus({
        message: 'The in-app download failed, so the GitHub installer download was opened in your browser.'
      });
      return updateStatus;
    }

    setUpdateStatus({
      phase: 'error',
      message: error instanceof Error ? error.message : 'Update download failed.'
    });
  }

  return updateStatus;
}

async function uniqueNotePath(parentPath: string, title: string) {
  const cleanTitle = title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Untitled';
  const folder = resolveVaultPath(parentPath);
  let candidate = `${cleanTitle}.md`;
  let counter = 2;
  while (await pathExists(path.join(folder, candidate))) {
    candidate = `${cleanTitle} ${counter}.md`;
    counter += 1;
  }
  return { absolute: path.join(folder, candidate), relative: path.join(parentPath, candidate).replace(/\\/g, '/') };
}

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
  if (patch.editorMode) storeSet('editorMode', patch.editorMode);
  if (typeof patch.splitPreview === 'boolean') storeSet('splitPreview', patch.splitPreview);
  if (patch.theme) storeSet('theme', patch.theme);
  if (typeof patch.vaultPath === 'string') setVaultPath(patch.vaultPath);
  return getSettings();
});

ipcMain.handle('updates:getStatus', () => updateStatus);
ipcMain.handle('updates:check', () => checkForUpdates(true));
ipcMain.handle('updates:download', () => downloadUpdate());
ipcMain.handle('updates:install', () => {
  if (app.isPackaged && updateStatus.phase === 'downloaded') {
    autoUpdater.quitAndInstall(false, true);
  } else if (updateStatus.source === 'github-api' && updateStatus.releaseUrl) {
    void shell.openExternal(updateStatus.releaseUrl);
  }
  return updateStatus;
});

ipcMain.handle('vault:open', async () => {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    : await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return getSettings().vaultPath;
  setVaultPath(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('vault:snapshot', () => snapshot());
ipcMain.handle('vault:readNote', async (_event, notePath: string) => fs.readFile(resolveVaultPath(notePath), 'utf8'));
ipcMain.handle('vault:writeNote', async (_event, notePath: string, content: string) => {
  await fs.writeFile(resolveVaultPath(notePath), content, 'utf8');
  return true;
});
ipcMain.handle('vault:createNote', async (_event, parentPath: string, title: string) => {
  const next = await uniqueNotePath(parentPath, title);
  await fs.writeFile(next.absolute, `# ${path.basename(next.relative, '.md')}\n\n`, 'utf8');
  return next.relative;
});
ipcMain.handle('vault:createFolder', async (_event, parentPath: string, folderName: string) => {
  const cleanName = folderName.replace(/[<>:"/\\|?*]+/g, '').trim() || 'New Folder';
  const target = resolveVaultPath(path.join(parentPath, cleanName));
  await fs.mkdir(target, { recursive: false });
  return path.relative(resolveVaultPath(''), target).replace(/\\/g, '/');
});
ipcMain.handle('vault:rename', async (_event, itemPath: string, nextName: string) => {
  const current = resolveVaultPath(itemPath);
  const cleanName = nextName.replace(/[<>:"/\\|?*]+/g, '').trim();
  if (!cleanName) throw new Error('Name cannot be empty.');
  const target = path.join(path.dirname(current), cleanName);
  await fs.rename(current, target);
  return path.relative(resolveVaultPath(''), target).replace(/\\/g, '/');
});
ipcMain.handle('vault:delete', async (_event, itemPath: string) => {
  await fs.rm(resolveVaultPath(itemPath), { recursive: true, force: false });
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  watcher?.abort();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
