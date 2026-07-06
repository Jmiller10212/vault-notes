import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { marked } from 'marked';
import {
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  SplitSquareHorizontal,
  Trash2
} from 'lucide-react';
import type { AppSettings, NoteMeta, UpdateStatus, VaultNode, VaultSnapshot } from './types';

type Status = 'idle' | 'saving' | 'saved' | 'error';

const defaultSettings: AppSettings = {
  vaultPath: null,
  editorMode: 'textarea',
  splitPreview: true
};

const defaultUpdateStatus: UpdateStatus = {
  phase: 'idle',
  message: 'Updates have not been checked yet.',
  isPackaged: false
};

marked.use({
  breaks: true,
  gfm: true
});

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function basename(notePath: string) {
  return notePath.split('/').pop() ?? notePath;
}

function parentPath(notePath: string) {
  const parts = notePath.split('/');
  parts.pop();
  return parts.join('/');
}

function noteSlug(meta: NoteMeta) {
  return meta.title.toLowerCase().trim();
}

function filterTree(nodes: VaultNode[], query: string): VaultNode[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return nodes;
  return nodes
    .map((node) => {
      if (node.type === 'file') return node.name.toLowerCase().includes(clean) ? node : null;
      const children = filterTree(node.children ?? [], query);
      return children.length || node.name.toLowerCase().includes(clean) ? { ...node, children } : null;
    })
    .filter((node): node is VaultNode => Boolean(node));
}

function collectFolderPaths(nodes: VaultNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'folder') return [node.path, ...collectFolderPaths(node.children ?? [])];
    return [];
  });
}

function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => {
    const withWikiLinks = content.replace(/\[\[([^\]]+)\]\]/g, (_match, label: string) => {
      const text = String(label).split('|').pop()?.trim() || label;
      return `[${text}](#)`;
    });
    return marked.parse(withWikiLinks) as string;
  }, [content]);

  return <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CodeMirrorEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: '#1f1f27', color: '#e7e3f0' },
          '.cm-scroller': { fontFamily: 'Inter, Segoe UI, system-ui, sans-serif', fontSize: '16px', lineHeight: '1.65' },
          '.cm-gutters': { backgroundColor: '#1f1f27', color: '#746f82', border: 'none' },
          '.cm-activeLineGutter': { backgroundColor: '#2a2933' },
          '.cm-activeLine': { backgroundColor: '#282631' },
          '.cm-content': { padding: '22px 28px' },
          '.cm-line': { padding: '0 4px' }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        })
      ]
    });

    viewRef.current = new EditorView({ state, parent: hostRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
  }, [value]);

  return <div className="codemirror-host" ref={hostRef} />;
}

function FileTree({
  nodes,
  activePath,
  expanded,
  onToggle,
  onSelect,
  onRename,
  onDelete
}: {
  nodes: VaultNode[];
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onRename: (node: VaultNode) => void;
  onDelete: (node: VaultNode) => void;
}) {
  return (
    <div className="tree">
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        const isActive = activePath === node.path;
        return (
          <div key={node.path}>
            <div className={`tree-row ${isActive ? 'active' : ''}`}>
              <button
                className="tree-main"
                type="button"
                onClick={() => (node.type === 'folder' ? onToggle(node.path) : onSelect(node.path))}
                title={node.path}
              >
                {node.type === 'folder' ? isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : <BookOpen size={15} />}
                {node.type === 'folder' ? isOpen ? <FolderOpen size={15} /> : <Folder size={15} /> : null}
                <span>{node.name}</span>
              </button>
              <button className="icon-button subtle" type="button" onClick={() => onRename(node)} title="Rename">
                <Pencil size={14} />
              </button>
              <button className="icon-button subtle" type="button" onClick={() => onDelete(node)} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
            {node.type === 'folder' && isOpen ? (
              <div className="tree-children">
                <FileTree
                  nodes={node.children ?? []}
                  activePath={activePath}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [snapshot, setSnapshot] = useState<VaultSnapshot>({ vaultPath: null, tree: [], notes: [] });
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'updates'>('general');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(defaultUpdateStatus);
  const [selectedFolder, setSelectedFolder] = useState('');

  const saveTimer = useRef<number | null>(null);
  const activeMeta = snapshot.notes.find((note) => note.path === activePath) ?? null;

  const refresh = useCallback(async () => {
    const next = await window.notesApi.vault.snapshot();
    setSnapshot(next);
    setExpanded((current) => {
      const nextExpanded = new Set(current);
      collectFolderPaths(next.tree).forEach((folderPath) => {
        if (!current.size) nextExpanded.add(folderPath);
      });
      return nextExpanded;
    });
    if (!activePath && next.notes[0]) setActivePath(next.notes[0].path);
  }, [activePath]);

  useEffect(() => {
    Promise.all([window.notesApi.settings.get(), window.notesApi.vault.snapshot()]).then(([nextSettings, nextSnapshot]) => {
      setSettings(nextSettings);
      setSnapshot(nextSnapshot);
      setExpanded(new Set(collectFolderPaths(nextSnapshot.tree)));
      if (nextSnapshot.notes[0]) setActivePath(nextSnapshot.notes[0].path);
    });

    return window.notesApi.vault.onChanged(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    window.notesApi.updates.getStatus().then(setUpdateStatus);
    return window.notesApi.updates.onStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (!activePath) {
      setContent('');
      return;
    }
    window.notesApi.vault.readNote(activePath).then(setContent).catch(() => setStatus('error'));
  }, [activePath]);

  const updateSettings = async (patch: Partial<AppSettings>) => {
    const next = await window.notesApi.settings.update(patch);
    setSettings(next);
  };

  const updateContent = (nextContent: string) => {
    setContent(nextContent);
    if (!activePath) return;
    setStatus('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      window.notesApi.vault
        .writeNote(activePath, nextContent)
        .then(() => {
          setStatus('saved');
          void refresh();
        })
        .catch(() => setStatus('error'));
    }, 450);
  };

  const openVault = async () => {
    await window.notesApi.vault.openVault();
    const next = await window.notesApi.vault.snapshot();
    setSnapshot(next);
    setActivePath(next.notes[0]?.path ?? null);
    setSelectedFolder('');
  };

  const showUpdates = () => {
    setSettingsTab('updates');
    setShowSettings(true);
  };

  const checkUpdates = async () => {
    setUpdateStatus(await window.notesApi.updates.check());
  };

  const downloadUpdate = async () => {
    setUpdateStatus(await window.notesApi.updates.download());
  };

  const installUpdate = async () => {
    setUpdateStatus(await window.notesApi.updates.install());
  };

  const createNote = async () => {
    const title = window.prompt('Note title', 'Untitled');
    if (!title) return;
    const nextPath = await window.notesApi.vault.createNote(selectedFolder, title);
    await refresh();
    setActivePath(nextPath);
  };

  const createFolder = async () => {
    const title = window.prompt('Folder name', 'New Folder');
    if (!title) return;
    const nextPath = await window.notesApi.vault.createFolder(selectedFolder, title);
    setExpanded((current) => new Set([...current, nextPath]));
    await refresh();
  };

  const renameNode = async (node: VaultNode) => {
    const nextName = window.prompt('New name', node.name);
    if (!nextName || nextName === node.name) return;
    const nextPath = await window.notesApi.vault.rename(node.path, nextName);
    if (activePath === node.path) setActivePath(nextPath);
    await refresh();
  };

  const deleteNode = async (node: VaultNode) => {
    if (!window.confirm(`Delete ${node.name}? This removes it from disk.`)) return;
    await window.notesApi.vault.delete(node.path);
    if (activePath === node.path || activePath?.startsWith(`${node.path}/`)) setActivePath(null);
    await refresh();
  };

  const searchResults = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return snapshot.notes;
    return snapshot.notes.filter((note) => {
      return [note.title, note.name, note.excerpt, note.tags.join(' '), note.links.join(' ')].join(' ').toLowerCase().includes(clean);
    });
  }, [query, snapshot.notes]);

  const backlinks = useMemo(() => {
    if (!activeMeta) return [];
    const activeNames = new Set([noteSlug(activeMeta), activeMeta.name.replace(/\.md$/i, '').toLowerCase()]);
    return snapshot.notes.filter((note) => note.path !== activeMeta.path && note.links.some((link) => activeNames.has(link.toLowerCase())));
  }, [activeMeta, snapshot.notes]);

  const filteredTree = useMemo(() => filterTree(snapshot.tree, query), [snapshot.tree, query]);
  const allFolders = useMemo(() => collectFolderPaths(snapshot.tree), [snapshot.tree]);
  const hasUpdateNotice = ['available', 'downloading', 'downloaded'].includes(updateStatus.phase);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <strong>Vault Notes</strong>
            <span>{snapshot.vaultPath ?? 'No vault open'}</span>
          </div>
          <button className="icon-button" type="button" onClick={() => setShowSettings((value) => !value)} title="Settings">
            <Settings size={18} />
          </button>
        </div>

        <div className="toolbar">
          <button type="button" onClick={createNote} title="New note">
            <FilePlus2 size={17} />
            <span>Note</span>
          </button>
          <button type="button" onClick={createFolder} title="New folder">
            <FolderPlus size={17} />
            <span>Folder</span>
          </button>
          <button className="icon-button" type="button" onClick={refresh} title="Refresh">
            <RefreshCw size={17} />
          </button>
        </div>

        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
        </label>

        <label className="folder-select">
          <span>New items in</span>
          <select value={selectedFolder} onChange={(event) => setSelectedFolder(event.target.value)}>
            <option value="">Vault root</option>
            {allFolders.map((folderPath) => (
              <option key={folderPath} value={folderPath}>
                {folderPath}
              </option>
            ))}
          </select>
        </label>

        <FileTree
          nodes={filteredTree}
          activePath={activePath}
          expanded={expanded}
          onToggle={(folderPath) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(folderPath)) next.delete(folderPath);
              else next.add(folderPath);
              return next;
            })
          }
          onSelect={setActivePath}
          onRename={renameNode}
          onDelete={deleteNode}
        />
      </aside>

      <main className="workspace">
        <header className="note-header">
          <div>
            <span className="eyebrow">{activePath ? parentPath(activePath) || 'Vault root' : 'No note selected'}</span>
            <h1>{activeMeta?.title ?? (activePath ? basename(activePath).replace(/\.md$/i, '') : 'Choose or create a note')}</h1>
          </div>
          <div className="header-actions">
            {hasUpdateNotice ? (
              <button className={`update-indicator ${updateStatus.phase}`} type="button" onClick={showUpdates} title={updateStatus.message}>
                {updateStatus.phase === 'downloaded' ? <DownloadCloud size={16} /> : <Bell size={16} />}
                <span>{updateStatus.phase === 'downloaded' ? 'Ready' : 'Update'}</span>
              </button>
            ) : null}
            <span className={`status ${status}`}>
              {status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Error' : 'Ready'}
            </span>
            <button
              className={`mode-button ${settings.editorMode === 'textarea' ? 'active' : ''}`}
              type="button"
              onClick={() => void updateSettings({ editorMode: settings.editorMode === 'textarea' ? 'codemirror' : 'textarea' })}
              title="Toggle Grammarly-friendly editor mode"
            >
              <Check size={16} />
              <span>{settings.editorMode === 'textarea' ? 'Grammarly mode' : 'Code mode'}</span>
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void updateSettings({ splitPreview: !settings.splitPreview })}
              title="Toggle split preview"
            >
              {settings.splitPreview ? <SplitSquareHorizontal size={18} /> : <PanelRight size={18} />}
            </button>
          </div>
        </header>

        {showSettings ? (
          <section className="settings-panel">
            <div className="settings-tabs" role="tablist" aria-label="Settings sections">
              <button className={settingsTab === 'general' ? 'active' : ''} type="button" onClick={() => setSettingsTab('general')}>
                General
              </button>
              <button className={settingsTab === 'updates' ? 'active' : ''} type="button" onClick={() => setSettingsTab('updates')}>
                Updates
                {hasUpdateNotice ? <span className="tab-dot" /> : null}
              </button>
            </div>

            {settingsTab === 'general' ? (
              <div className="settings-content">
                <div className="setting-summary">
                  <strong>Vault folder</strong>
                  <span>{snapshot.vaultPath}</span>
                </div>
                <button type="button" onClick={openVault}>
                  <FolderOpen size={17} />
                  <span>Open Vault</span>
                </button>
                <label>
                  <span>Editor</span>
                  <select value={settings.editorMode} onChange={(event) => void updateSettings({ editorMode: event.target.value as AppSettings['editorMode'] })}>
                    <option value="textarea">Grammarly-friendly textarea</option>
                    <option value="codemirror">CodeMirror Markdown</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="settings-content updates-content">
                <div className={`update-status ${updateStatus.phase}`}>
                  <strong>{updateStatus.phase === 'available' ? 'Update available' : updateStatus.phase === 'downloaded' ? 'Update ready' : 'App updates'}</strong>
                  <span>{updateStatus.message}</span>
                  {typeof updateStatus.percent === 'number' ? (
                    <div className="progress-track">
                      <div style={{ width: `${Math.min(100, Math.max(0, updateStatus.percent))}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="update-actions">
                  <button type="button" onClick={checkUpdates} disabled={updateStatus.phase === 'checking' || updateStatus.phase === 'downloading'}>
                    <RefreshCw size={17} />
                    <span>{updateStatus.phase === 'checking' ? 'Checking' : 'Check Now'}</span>
                  </button>
                  <button type="button" onClick={downloadUpdate} disabled={updateStatus.phase !== 'available'}>
                    <DownloadCloud size={17} />
                    <span>Download</span>
                  </button>
                  <button type="button" onClick={installUpdate} disabled={updateStatus.phase !== 'downloaded'}>
                    <Check size={17} />
                    <span>Install</span>
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className={`editor-layout ${settings.splitPreview ? 'split' : ''}`}>
          <div className="editor-pane">
            {activePath ? (
              settings.editorMode === 'codemirror' ? (
                <CodeMirrorEditor value={content} onChange={updateContent} />
              ) : (
                <textarea
                  className="plain-editor"
                  spellCheck
                  value={content}
                  onChange={(event) => updateContent(event.target.value)}
                  placeholder="Start writing..."
                />
              )
            ) : (
              <div className="empty-state">
                <BookOpen size={42} />
                <h2>No note selected</h2>
                <p>Create a Markdown note or open an existing one from the vault.</p>
              </div>
            )}
          </div>
          {settings.splitPreview ? (
            <aside className="preview-pane">
              <MarkdownPreview content={content} />
            </aside>
          ) : null}
        </section>
      </main>

      <aside className="rightbar">
        <section>
          <h2>Search</h2>
          <div className="result-list">
            {searchResults.slice(0, 30).map((note) => (
              <button key={note.path} type="button" className={note.path === activePath ? 'active' : ''} onClick={() => setActivePath(note.path)}>
                <strong>{note.title}</strong>
                <span>{note.excerpt || note.path}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Tags</h2>
          <div className="tag-list">
            {(activeMeta?.tags ?? []).length ? activeMeta!.tags.map((tag) => <span key={tag}>#{tag}</span>) : <em>No tags</em>}
          </div>
        </section>

        <section>
          <h2>Backlinks</h2>
          <div className="result-list compact">
            {backlinks.length ? (
              backlinks.map((note) => (
                <button key={note.path} type="button" onClick={() => setActivePath(note.path)}>
                  <strong>{note.title}</strong>
                  <span>{formatDate(note.updatedAt)}</span>
                </button>
              ))
            ) : (
              <em>No backlinks</em>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
