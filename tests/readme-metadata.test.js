'use strict';

const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const nodeMinimum = pkg.engines.node.match(/\d+\.\d+\.\d+/)[0];
const electronMajor = pkg.devDependencies.electron.match(/\d+/)[0];

describe('README release metadata', () => {
    test('version badge matches package.json', () => {
        expect(readme).toContain(`version-${pkg.version}-blue.svg`);
    });

    test('Node.js badge matches the supported minimum version', () => {
        expect(readme).toContain(`node-%3E%3D${nodeMinimum}-brightgreen.svg`);
    });

    test('Electron table matches the installed major version', () => {
        expect(readme).toContain(`Electron ${electronMajor}`);
    });

    test('Express table matches the installed major version (no Express 5 claim)', () => {
        const expressMajor = (pkg.dependencies.express.match(/\d+/) || [])[0];
        expect(expressMajor).toBeTruthy();
        expect(readme).toContain(`Express ${expressMajor}`);
        expect(readme).not.toMatch(/Express\s*5/);
    });

    test('installer example matches electron-builder artifact naming', () => {
        expect(readme).toContain(`KarimERP-Setup-${pkg.version}-x64.exe`);
    });
});
