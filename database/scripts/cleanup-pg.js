const fs = require('fs');
const path = require('path');

const EXTRACT_PATH = path.join(__dirname, '..', 'bin');

const unnecessaryFolders = [
    'doc',
    'include',
    'symbols',
    'pgAdmin 4',
    'StackBuilder'
];

console.log('Cleaning up unnecessary PostgreSQL files...');

for (const folder of unnecessaryFolders) {
    const folderPath = path.join(EXTRACT_PATH, folder);
    if (fs.existsSync(folderPath)) {
        try {
            fs.rmdirSync(folderPath, { recursive: true });
            console.log(`Deleted: ${folder}`);
        } catch (e) {
            console.error(`Failed to delete ${folder}:`, e.message);
        }
    }
}

console.log('Cleanup complete. Only necessary files (bin, lib, share) are kept.');
