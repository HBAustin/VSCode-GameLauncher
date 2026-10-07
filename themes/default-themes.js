// Default theme presets for the launcher

const THEMES = {
    dark: {
        name: 'Dark',
        colors: {
            background: '#1a1a1a',
            surface: '#2a2a2a',
            text: '#e0e0e0',
            accent: '#6366f1'
        },
        fonts: {
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            sizeBase: '14px'
        }
    },

    light: {
        name: 'Light',
        colors: {
            background: '#f5f5f5',
            surface: '#ffffff',
            text: '#1a1a1a',
            accent: '#ffffff'
        },
        fonts: {
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            sizeBase: '14px'
        }
    },

    cyberpunk: {
        name: 'Cyberpunk 2077',
        colors: {
            background: '#0b0b0b',
            surface: '#1d1d1d',
            text: '#f4f4f4',
            accent: '#fcee0a'
        },
        fonts: {
            family: '"Courier New", monospace',
            sizeBase: '14px'
        }
    },

    minimal: {
        name: 'Minimal',
        colors: {
            background: '#ffffff',
            surface: '#ffffff',
            text: '#111111',
            accent: '#111111'
        },
        fonts: {
            family: '"Helvetica Neue", Arial, sans-serif',
            sizeBase: '13px'
        }
    },

    ocean: {
        name: 'Ocean',
        colors: { background: '#0d1b24', surface: '#163746', text: '#e9f4f7', accent: '#20c4d8' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    forest: {
        name: 'Forest',
        colors: { background: '#111a14', surface: '#26372a', text: '#eef5e8', accent: '#9acc48' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    sunset: {
        name: 'Sunset',
        colors: { background: '#24191f', surface: '#3b2630', text: '#fff0e8', accent: '#ff896f' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    mint: {
        name: 'Mint',
        colors: { background: '#eaf5ef', surface: '#f9fffb', text: '#183229', accent: '#248b65' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    ember: {
        name: 'Ember',
        colors: { background: '#211613', surface: '#38241e', text: '#f7ece2', accent: '#ff754d' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    arcade: {
        name: 'Arcade',
        colors: { background: '#171528', surface: '#282442', text: '#f3f1ff', accent: '#ff5caa' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    arctic: {
        name: 'Arctic',
        colors: { background: '#edf4f8', surface: '#ffffff', text: '#172531', accent: '#067e98' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' }
    },

    liquidGlass: {
        name: 'Windows Acrylic',
        colors: { background: '#17191c', surface: '#45494d', text: '#f4f6f8', accent: '#dce3e8' },
        fonts: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', sizeBase: '14px' },
        experimental: true
    }
};

module.exports = THEMES;
