# Vault Notes

Vault Notes is a Windows desktop Markdown notes app with an Obsidian-style layout and a Grammarly-friendly writing mode.

## Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run dist:win
```

The Windows installer and portable EXE are generated in `release/`.

## Releases and Updates

The app checks GitHub releases from `Jmiller10212/vault-notes`.

To publish an update:

```powershell
npm version patch
git push
git push --tags
```

Pushing a `v*` tag starts the GitHub Actions release workflow, which builds and publishes the Windows release files used by the in-app updater.
