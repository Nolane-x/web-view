# Nolane Infinite Workspace

A local-first infinite canvas for arranging real websites, notes and tools in one personal workspace.

## GitHub Pages

This repository is deployed as a static GitHub Pages site from the `main` branch through the GitHub Actions workflow in `.github/workflows/pages.yml`.

## Product principles

- Workspace layout is stored in the user's browser (IndexedDB); there is no application backend.
- Website surfaces load directly from their original origins. A site may refuse iframe embedding; use **Open in browser** in that case.
- No passwords, cookies or service tokens are collected or transmitted by this workspace.
- The Browser Companion connection is an integration point, not a claim that a companion extension is already installed.

## Local development

Serve this directory over HTTP (for example `python -m http.server 8000`) and open `http://localhost:8000`. A local HTTP server is recommended because service workers and IndexedDB have browser security requirements.

## Current scope

The static workspace provides an infinite pan/zoom canvas, website cards, notes, local persistence, JSON import/export, search, keyboard shortcuts and an optional PWA shell. Universal authenticated website composition requires a future native browser runtime; a standard static page or MV3 extension cannot turn arbitrary Chrome tabs into first-class DOM surfaces.
