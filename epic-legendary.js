function parseLegendaryGames(output) {
    let data;
    try {
        data = JSON.parse(String(output || '').trim());
    } catch (error) {
        throw new Error(`Legendary returned invalid JSON: ${error.message}`);
    }

    const listing = data && typeof data === 'object' && !Array.isArray(data) && data.games
        ? data.games
        : data;
    const entries = Array.isArray(listing)
        ? listing.map(entry => ({ entry, key: '' }))
        : listing && typeof listing === 'object'
            ? Object.entries(listing).map(([key, entry]) => ({ entry, key }))
            : [];

    return entries.flatMap(({ entry, key }) => {
        if (!entry || typeof entry !== 'object') return [];
        const appName = String(entry.app_name || entry.appName || entry.id || key).trim();
        const name = String(entry.app_title || entry.title || entry.name || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(appName) || !name) return [];

        const candidateImages = entry.metadata?.keyImages || entry.asset_info?.keyImages
            || entry.assetInfo?.keyImages || entry.keyImages;
        const images = Array.isArray(candidateImages) ? candidateImages : [];
        const imageUrl = (pattern) => {
            const image = images.find((item) => pattern.test(String(item.type || '')) && /^https?:\/\//i.test(String(item.url || '')));
            return image ? String(image.url) : '';
        };
        const isInstalled = entry.is_installed === true || entry.isInstalled === true
            || !!(entry.install_path || entry.installPath);

        return [{
            appName,
            name,
            namespace: String(entry.namespace || ''),
            catalogItemId: String(entry.catalog_item_id || entry.catalogItemId || ''),
            installed: isInstalled,
            cover: imageUrl(/(?:DieselGameBoxTall|OfferImageTall)/i),
            background: imageUrl(/(?:DieselGameBoxWide|OfferImageWide|Screenshot|DieselGameBox(?!Tall))/i)
        }];
    });
}

function parseLegendaryInstalledGames(output) {
    let data;
    try {
        data = JSON.parse(String(output || '').trim());
    } catch (error) {
        throw new Error(`Legendary returned invalid installed-games JSON: ${error.message}`);
    }

    const listing = data && typeof data === 'object' && !Array.isArray(data) && data.games
        ? data.games
        : data;
    const entries = Array.isArray(listing)
        ? listing.map(entry => ({ entry, key: '' }))
        : listing && typeof listing === 'object'
            ? Object.entries(listing).map(([key, entry]) => ({ entry, key }))
            : [];
    return new Set(entries
        .map(({ entry, key }) => String(entry?.app_name || entry?.appName || entry?.id || key || '').trim())
        .filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)));
}

module.exports = { parseLegendaryGames, parseLegendaryInstalledGames };
