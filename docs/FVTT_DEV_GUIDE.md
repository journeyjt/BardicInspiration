# Foundry Module Development LLM Guide

This guide compiles essential resources for developing modules in Foundry Virtual Tabletop (VTT). It highlights official documentation, community best practices, modern tooling, templates, and examples. Each entry includes a brief description and a direct link for further exploration.

## Core Development Guides

- **Introduction to Module Development** – Official guide on creating add-on modules, explaining required folder structure (`Data/modules/<id>`), mandatory `module.json` attributes (id, title, description, version) and recommended directories like `templates`, `scripts`, `styles`, `packs` and `lang`. It covers loading JavaScript via `scripts` or `esmodules` and provides example hook usage. [Article](https://foundryvtt.com/article/module-development/) :contentReference[oaicite:0]{index=0}.

- **Introduction to Development** – Explains Foundry’s package ecosystem (game worlds, systems, modules), recommends learning JavaScript, and introduces key API concepts such as Documents, Flags and Hooks. It stresses version control and localization. [Article](https://foundryvtt.com/article/intro-development/) :contentReference[oaicite:1]{index=1}.

- **ApplicationV2 and Form Conversion** – Community wiki articles on the modern `ApplicationV2` class and how to migrate from `FormApplication`. They describe lifecycle hooks (`_prepareContext`, `_onRender`), default options, the `PARTS` template structure, and form handlers. [ApplicationV2](https://foundryvtt.wiki/en/development/applicationv2) :contentReference[oaicite:2]{index=2}, [Converting to ApplicationV2](https://foundryvtt.wiki/en/development/guides/applicationv2-conversion) :contentReference[oaicite:3]{index=3}.

- **Data Model & Document Sub-Types** – Foundry V10 introduced `DataModel` and custom document types. Guides show how to define `TypeDataModel` subclasses, add `documentTypes` to `module.json`, and register models in the `init` hook. [Data Model article](https://foundryvtt.wiki/en/development/data-model) :contentReference[oaicite:4]{index=4} and [System Data Models](https://foundryvtt.wiki/en/development/guides/system-data-models) :contentReference[oaicite:5]{index=5}.

- **Hooks and Event Framework** – Overview of the Hooks API, explaining `Hooks.on` vs `Hooks.once` and `callAll` vs `call`, plus a list of common hook names. It advises enabling `CONFIG.debug.hooks` or using Developer Mode to inspect hook arguments. [Hooks guide](https://foundryvtt.wiki/en/development/guides/hooks-overview) :contentReference[oaicite:6]{index=6}.

## Tools and Libraries

- **libWrapper** – Essential library for safe monkey-patching. Register wrappers via `libWrapper.register` in the `init` hook and specify wrapper types (`WRAPPER`, `MIXED`, `OVERRIDE`, `LISTENER`). [GitHub README](https://github.com/foundryvtt-dnd/libWrapper) :contentReference[oaicite:7]{index=7}.

- **Developer Mode Module** – Enables debug flags, prints documents to console, disables template caching, and registers module-specific debug settings. [GitHub README](https://github.com/league-of-foundry-developers/fvtt-module-devmode) :contentReference[oaicite:8]{index=8}.

- **Find the Culprit!** – A module that halves the list of active modules to identify which one causes errors. A useful debugging tool recommended by experienced developers. [Foundry package page](https://foundryvtt.com/packages/find-the-culprit/) :contentReference[oaicite:9]{index=9}.

- **Vite for Foundry Modules** – Guide to bundling and hot module replacement using Vite. It provides a sample `vite.config.ts`, explains how to proxy requests, build ES modules, and set up a dev server with HMR. [Guide](https://foundryvtt.wiki/en/development/guides/vite) :contentReference[oaicite:10]{index=10}.

## Best Practices and Publishing

- **Package Development Best Practices** – Checklist covering semantic versioning, stable manifest & download URLs, localization, file naming, exposing APIs via `game.modules.get('id')?.api`, defensive coding when overwriting core behaviour and UI guidelines for sidebar buttons. [Checklist](https://foundryvtt.wiki/en/development/guides/package-best-practices) :contentReference[oaicite:11]{index=11}.

- **Publishing a Module** – Step-by-step instructions to host your module on GitHub: adding `manifest` and `download` links to `module.json`, creating a zip, uploading assets to a release and retrieving the manifest URL. Advises against prefixing version tags with `v`. [Guide](https://foundryvtt.wiki/en/development/guides/local-to-repo) :contentReference[oaicite:12]{index=12}.

## Templates & Example Projects

- **FoundryVTT Module Template (JavaScript)** – GitHub template with CI for automated releases. It stresses using release-specific manifest URLs rather than `/latest`. [Repo](https://github.com/League-of-Foundry-Developers/FoundryVTT-Module-Template) :contentReference[oaicite:13]{index=13}.

- **Foundry Module TypeScript Template** – Demo template with TS, Vite and an example button that fetches a dog image. Update `module.json` fields and localization prefix when starting a new project. [Repo](https://github.com/BringingFire/foundry-module-ts-template) :contentReference[oaicite:14]{index=14}.

- **DFreds Module Template TS** – Template geared toward Pathfinder 2e with symlink integration, Vite build scripts and commands to update types, lint, build and link the module. [Docs](https://www.dfreds-modules.com/module-template-ts) :contentReference[oaicite:15]{index=15}.

- **Template Svelte ESM (TyphonJS)** – Bare-bones template using Svelte and the TyphonJS Runtime Library. Requires modifying `module.json` and `vite.config.mjs` for your module ID, then running `npm run build` or `npm run dev` to use HMR. [Repo](https://github.com/typhonjs-fvtt-demo/template-svelte-esm) :contentReference[oaicite:16]{index=16}.

- **TyphonJS Runtime Library** – Shared Svelte runtime with reactive UI components and application shells for Foundry. Add it via npm and refer to its API docs. [NPM package](https://www.npmjs.com/package/@typhonjs-fvtt/runtime) :contentReference[oaicite:17]{index=17}.

- **Party Resources Module** – Example of a complete system-agnostic module that tracks party-wide numeric values, supports icons, live updates and macros, and uses a public API. [Repo](https://github.com/davelens/fvtt-party-resources) :contentReference[oaicite:18]{index=18}.

## Additional Advice

- **Explore existing modules before writing your own** – Veteran developer IronMonk recommends studying what’s already available, starting small, learning how Foundry behaves without other modules and using libWrapper and Find the Culprit to troubleshoot. He also emphasises being polite and asking the community for help:contentReference[oaicite:19]{index=19}.

- **Use semantic versioning and avoid `v` prefixes** – Foundry compares version numbers lexically; treat versions as strings (e.g., `"1.2.0"` not `1.2`) and update the version for any change. Avoid using `v` prefixes or pre-release tags:contentReference[oaicite:20]{index=20}.

- **Plan for localization** – Group strings logically, avoid splitting phrases in ways that break other languages, allow extra space for languages with longer words and keep your localization keys within your module namespace:contentReference[oaicite:21]{index=21}.

- **Expose public APIs** – Provide an API via `game.modules.get('module-id')?.api` and use custom hooks for inter-module communication:contentReference[oaicite:22]{index=22}.

- **Publish via GitHub releases** – Use stable manifest and download URLs pointing to release assets. Do not use `latest` links for download. Create a `module.zip` and release it along with `module.json`:contentReference[oaicite:23]{index=23}.

Feel free to explore the linked articles and repositories to deepen your understanding and set up your own module. Following these guidelines will help ensure your module is robust, maintainable and compatible with future Foundry VTT updates.
