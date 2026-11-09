HB Launcher

Electron based unified launcher using simple HTML/JS code 

Since the launcher uses Electron it can *technically* easily be built on any system (built with VS Code, node.js - use npm build dist for a native version for your OS)
Currently only allows you to add exe files and windows shortcuts, will add native mac and Linux support soon

+Add game
Right click on game / Press X or SQUARE on your controller to open additional context menu:

Favorite game (always appears first in launcher)
Rename
Add cover using SteamGridDB (API Key needed)
Open / Edit file location
Remove game from library

XBOX controller (any Xinput device should work)
PS controller (tested with DS4 and DualSense controllers)
* Switch Pro Controller / joy cons *MAY* work but are untested - will likely show XBOX glyhs if it does work

--SteamGridDB--

Cover images (should) save to Your documents folder:

C:\Users\yourname\Documents\HB-Launcher-Covers

Images should delete themselves if not in use

--Steam Library Sync--

Open Settings -> Steam Library, enter your SteamID64 (or profile URL) and Steam Web API key, then choose "Sync Steam library". Steam's game-details privacy must be public for its owned-games API to return the library, and the same account must be signed in to the Steam client for installs to go to the right account. The API key is stored in the launcher's local settings and is not bundled with the app.

Synced entries store game metadata only. Selecting an uninstalled game opens Steam's installer; installed games launch through Steam. Steam artwork is loaded from Steam's CDN as needed.

Use the **All games / Installed** control beside **Your games** to switch library views, and the launcher dropdown to filter Steam, Epic, GOG, or other games. Both selections are remembered on this computer. Uninstalled Steam games are dimmed. Steam's public owned-games API does not include titles shared with you. The installed-games importer may find shared titles already installed on this computer, but Steam does not provide a supported API for listing the full shared library.

--Epic Library Sync--

The installed-games importer detects Epic games already installed through the Epic Games Launcher. To sync your full Epic library, download the standalone Legendary executable from its [releases page](https://github.com/derrod/legendary/releases), select it in Settings -> Epic Library, and use **Sign in with Epic**. Finish authentication in Legendary, then choose **Sync Epic library**. The launcher does not request or store your Epic password or Legendary tokens. Install and launch actions are run through Legendary.

Epic does not publish a general-purpose API for third-party launchers to enumerate an account library; Legendary is a community tool that relies on Epic services that may change. It is not bundled with HB Launcher. Review Legendary's license and documentation before installing or using it.
