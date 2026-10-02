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
            accent: '#6366f1'
        },
        fonts: {
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            sizeBase: '14px'
        }
    },

    cyberpunk: {
        name: 'Cyberpunk',
        colors: {
            background: '#0a0e27',
            surface: '#1a1f3a',
            text: '#00ff9f',
            accent: '#ff006e'
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
    }
};

module.exports = THEMES;
