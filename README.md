# HB Launcher

**Version 3.0.1** is an Electron desktop game library and launcher built with HTML, CSS, and JavaScript.

## What's New Since 2.0

Compared with the earlier add-and-manage launcher, 3.0.1 brings together games from multiple storefronts and adds:

- Steam library sync, installed-game discovery, install status, and launch-through-Steam support.
- Epic library sync through the standalone Legendary tool, plus installed-game discovery for Epic and GOG on Windows.
- Per-game launch options, including launch mode, arguments, working folder, startup delay, minimize-on-launch, and Windows administrator launch.
- Game artwork management through SteamGridDB, custom and preset themes, full-screen library mode, and display settings.
- Controller navigation for the library, menus, settings, and launch options.
- An optional Windows FPS overlay powered by PresentMon.

## Platforms

The project has explicit build scripts for Windows and macOS. Windows builds are portable; macOS builds produce DMG and ZIP packages. Steam installation discovery also checks common Steam library locations on Linux, but Linux packaging is not explicitly configured. Epic and GOG installed-game discovery is Windows-only.

## Run and Build

Install [Node.js](https://nodejs.org/) and then run:

```sh
npm install
npm start
```

Build a package for the current platform with `npm run dist`, or use the platform-specific scripts:

```sh
npm run dist:win
npm run dist:mac
```

The Windows target is a portable executable. The macOS targets are DMG and ZIP.

## Library and Game Management

Use **Add game** to browse for a game or scan for installed games. The scanner can find installed Steam games on supported desktop platforms, and Epic/GOG games on Windows. You can also right-click a game or press **X** on Xbox-style controllers (or **Square** on PlayStation controllers) to open its options: favorite, rename, edit its path, customize artwork, open its folder, or remove it.

The **All games / Installed** control filters the library, and the launcher filter narrows it to Steam, Epic, GOG, or other games. These selections are remembered on this computer. Uninstalled Steam games are shown as not installed.

### Steam

Open **Settings -> Steam Library**, enter a SteamID64 or profile URL and a Steam Web API key, then select **Sync Steam library**. Steam game-details privacy must be public for the owned-games API to return the library. Keep the matching account signed in to the Steam client when installing games.

Synced entries contain game metadata, not game files. Selecting an uninstalled title opens Steam's install flow; installed titles launch through Steam when needed. Steam's public owned-games API does not include games shared with you. The installed-game scanner may find shared titles already installed locally, but Steam has no supported API to list the full shared library.

The API key is saved in the launcher's local settings and is not bundled with the application.

### Epic Games

Epic does not provide a general-purpose third-party library API. To sync an Epic library, download the standalone [Legendary executable](https://github.com/derrod/legendary/releases), select it under **Settings -> Epic Library**, choose **Sign in with Epic**, finish authentication in Legendary, then choose **Sync Epic library**. Install and launch actions are handed to Legendary.

HB Launcher does not ask for or store your Epic password or Legendary tokens. Legendary is a community tool that relies on Epic services that may change; it is not bundled with HB Launcher. Review its license and documentation before use.

## Artwork and Customization

Connect a SteamGridDB API key under **Settings -> Artwork search** to search for covers, backgrounds, logos, and icons. Downloaded artwork is stored under your Documents folder in `HB-Launcher/Covers`, `HB-Launcher/Backgrounds`, `HB-Launcher/Logos`, and `HB-Launcher/Icons`.

Choose a preset theme or configure custom colors in **Settings -> Appearance**. Use **Settings -> Display preferences** to adjust interface scale and game-detail presentation.

## Controllers

Xbox/XInput controllers and PlayStation controllers (tested with DualShock 4 and DualSense) are supported. Nintendo Switch Pro Controllers and Joy-Cons are untested. Controller support can vary by device and operating system.

Controller navigation works across the library and menus. In Launch Options, use the D-pad to move between controls, A to activate, left/right to change the launch mode, and B to cancel. Text entry still requires a keyboard.

## Per-Game Launch Options and FPS Overlay

Open **Launch options** from a game's detail page to set its launch mode, arguments, working folder, startup delay, and other options. Automatic mode uses Steam for Steam games that need it and starts other games directly. Windows also supports running a game as administrator. Launch options can be controlled with a gamepad, but entering text requires a keyboard.

The optional FPS overlay is Windows-only and requires installing PresentMon separately. Enable it under **Settings -> Display preferences**, select the PresentMon executable, and set the game's process name in Launch Options when required. Press **Ctrl+Shift+O** to show or hide the overlay while a monitored game is running.
