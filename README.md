# YTM-RPC - YouTube Music Discord Rich Presence

This work is based on https://github.com/Louchatfroff/YTMusic-RPC but now it works  
the project looked ai-generated, my updates also are ai-generated (sorry)

## Features

- **Shows current song, artist, and album art on Discord as your activity**
- **Progress bar with elapsed/remaining time**
- Multi-browser compat

## Requirements

- [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) v18+, [pnpm](https://pnpm.io/)
- Discord desktop app (or Vencord) (no browser support)
- chromium or gecko

## Setup
there are two parts because you need to install the plugin into vencord and also the extension into your browser

### Vencord Plugin

**Requirements:** [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) v18+, [pnpm](https://pnpm.io/)
> **Tip:** As previously said, update to the **latest** stable release, risk 0 will never exist!

> **Note:** Custom plugins require building Vencord from source. See the [official guide](https://docs.vencord.dev/installing/).

1. **Clone and build Vencord** (if not already) (also works with equicord, pawesome-vencord etc):
   ```bash
   git clone https://github.com/Vendicated/Vencord
   cd Vencord
   pnpm install --frozen-lockfile
   pnpm build --dev
   pnpm inject
   ```
     because this is a userplugin so you can't load it very easily

2. **Get a Discord Application ID**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application → Copy the **Application ID**

3. **Install the plugin**
   - Copy the `vencord-plugin` folder to `Vencord/src/userplugins/ytmusicRpc` (you may need to create that folder) (inside the ytmusicRpc folder or whatever you choose to name it, the two .ts files should be there)
   - Rebuild: `pnpm build && sudo pnpm inject`
   - Restart Discord

4. **Configure**
   - Discord Settings → Vencord → Plugins → YTMusicRPC
   - Enter your Application ID in the field

See [vencord-plugin/README.md](vencord-plugin/README.md) for detailed instructions (i have not re read them)

### Install the browser extension
Ok so i tried in librewolf and chromium and things seemed to work fine (chromium showed "'background.scripts' requires manifest version of 2 or lower." but everything seemed to work so idk)
#### Firefox and the like
##### Temporarly load it
When you shutdown the browser you'll have to re-load it
1. Open `about:debugging#/runtime/this-firefox`
2. Click on Load temporary add-on
3. select any file in the extension folder  
##### Permanent way
We can tell firefox to not require signature onextensions. I am not responsible if you install evil extensions after that ! You take responsibility.
1. open `about:config`
2. search for `xpinstall.signatures.required`
3. set the boolean to false
4. in `about:addons` click setting > Install add-on from file
5. select the extension.zip  
tada, permanently loaded

#### Chromium
1. open `chrome://extensions`
2. enable developer mode (upper right corner)
3. click `load unpacked`
4. select the folder `extension`  
it looks permanent too (but you should still switch away from chromium if you can)
### Use It

1. Make sure Discord is running (with Vencord plugin loaded see this readme lol)
2. Play music on [YouTube Music](https://music.youtube.com) from the browser where you installed the extension
3. Your Discord status updates automatically!

## Project Structure

```
YTM-RPC/
├── vencord-plugin/         # Vencord plugin
│   └── ytmusicRpc.ts
└── extension/              # Browser extension
    ├── manifest.json
    ├── background.js
    ├── content.js
    └── popup.html/js
    other files there
```

## Troubleshooting

**Extension not connecting**
> - Make sure Vencord plugin is enabled
> - Check that port 8765 AND **8766** are not in use by another app

**Discord status not updating**
> - Enable "Display current activity" in Discord Settings → Activity Privacy
> - Verify your Application ID is correct

**Extension not detecting music**
> - Make sure you're on [music.youtube.com](https://music.youtube.com)
> - Refresh the YouTube Music page
> - Reload the extension

**When I pause the music it does weird shit**
> yeah idk sorry

## How does that work ?

There are two parts to this program :

**Firefox Extension**
> Divided in 3 different scripts: content, background and popup, they all have a different purpose :
> - **content** : Injected in music.youtube.com along with the whole extension, acts as a data retriever, observing DOM and media session changes and collects the data from the music every changes and formats the collected data to json.
> - **background** : Acts as a bridge between the browser and Vencord, sends updated fetched data via local HTTP to the discord plugin.
> - **popup** : User interface, shows the current state of the music, connection and possible errors.

> **Note:** Album art is fetched directly from the YouTube Music page or extracted URLs and no official YouTube Music API is used; DOM extraction + browser network data is the source.

**Vencord Plugin**
> Uses 2 different scripts: native and index, working together to :
> - Hook into Discord’s internal IPC to update rich presence.
> - Maintain local state of most recent metadata from the extension.
> - Perform smart timestamp synchronization: incrementing elapsed time every second, correctly handling seeking/ads/pauses, resyncing after drift or external state changes.
> - Use the extracted data to compute: startTimestamp, endTimestamp, cover art URL, artist & title strings.
> - Send one presence update per tick or on state change, respecting Discord’s rate limits (hence the very small delay on the RPC itself)
> - Vencord leverages internal Rich Presence hooks: similar logic to discord-rpc but native in-process, avoiding external RPC daemons or socket listeners and generates presence that Discord desktop app displays as user activity.



## License

GPL 3.0 Licence
