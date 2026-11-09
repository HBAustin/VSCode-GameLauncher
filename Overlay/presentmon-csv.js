function parseCsvLine(line) {
    const result = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"' && quoted) {
            value += '"';
            i++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            result.push(value);
            value = '';
        } else {
            value += char;
        }
    }
    result.push(value);
    return result;
}

function frameInterval(header, line) {
    const index = header.indexOf('MsBetweenPresents');
    if (index < 0) return null;
    const interval = Number(parseCsvLine(line)[index]);
    return Number.isFinite(interval) && interval > 0 && interval <= 1000 ? interval : null;
}

module.exports = { parseCsvLine, frameInterval };
