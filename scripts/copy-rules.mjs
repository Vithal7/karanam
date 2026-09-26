// Publishes the bundled tax rules as /rules.json so installed apps can pick up updates.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
mkdirSync(join(root, 'public'), { recursive: true });
copyFileSync(join(root, 'src', 'rules', 'rules.json'), join(root, 'public', 'rules.json'));
console.log('copied rules.json to public/');
