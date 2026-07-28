// Default theme presets for the launcher

const THEMES = {
    dark: {
        name: 'Dark',
        colors: {
            background: '#1a1a1a',
            surface: '#2a2a2a',
            surfaceHover: '#3a3a3a',
            text: '#e0e0e0',
            textSecondary: '#a0a0a0',
            accent: '#6366f1',
            accentHover: '#7c3aed',
            border: '#404040',
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444'
        },
        fonts: {
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            sizeBase: '14px',
            sizeHeading: '24px',
            sizeSmall: '12px'
        },
        layout: {
            cardSize: 'medium',
            sidebarWidth: '280px',
            compactMode: false,
            cardGap: '16px'
        }
    },

    light: {
        name: 'Light',
        colors: {
            background: '#f5f5f5',
            surface: '#ffffff',
            surfaceHover: '#f0f0f0',
            text: '#1a1a1a',
            textSecondary: '#666666',
            accent: '#6366f1',
            accentHover: '#4f46e5',
            border: '#e0e0e0',
            success: '#059669',
            warning: '#d97706',
            error: '#dc2626'
        },
        fonts: {
            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            sizeBase: '14px',
            sizeHeading: '24px',
            sizeSmall: '12px'
        },
        layout: {
            cardSize: 'medium',
            sidebarWidth: '280px',
            compactMode: false,
            cardGap: '16px'
        }
    },

    cyberpunk: {
        name: 'Cyberpunk',
        colors: {
            background: '#0a0e27',
            surface: '#1a1f3a',
            surfaceHover: '#232e52',
            text: '#00ff9f',
            textSecondary: '#00cc7f',
            accent: '#ff006e',
            accentHover: '#ff1493',
            border: '#00ff9f',
            success: '#00ff9f',
            warning: '#ffbe0b',
            error: '#ff006e'
        },
        fonts: {
            family: '"Courier New", monospace',
            sizeBase: '14px',
            sizeHeading: '24px',
            sizeSmall: '12px'
        },
        layout: {
            cardSize: 'medium',
            sidebarWidth: '280px',
            compactMode: false,
            cardGap: '12px'
        }
    },

    minimal: {
        name: 'Minimal',
        colors: {
            background: '#fafafa',
            surface: '#ffffff',
            surfaceHover: '#f8f8f8',
            text: '#333333',
            textSecondary: '#999999',
            accent: '#000000',
            accentHover: '#333333',
            border: '#f0f0f0',
            success: '#2ecc71',
            warning: '#f39c12',
            error: '#e74c3c'
        },
        fonts: {
            family: '"Helvetica Neue", Arial, sans-serif',
            sizeBase: '13px',
            sizeHeading: '20px',
            sizeSmall: '11px'
        },
        layout: {
            cardSize: 'small',
            sidebarWidth: '240px',
            compactMode: true,
            cardGap: '8px'
        }
    }
};

module.exports = THEMES;
