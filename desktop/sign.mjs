// 릴리스 DMG 에 업데이트 서명(.sig)을 붙인다: npm run sign (관리자만, npm run dist 다음에)
// 비밀 키는 저장소 밖: EPEIRA_SIGNING_KEY 또는 ~/.epeira-release/update-signing-key.pem
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = f => new URL(f, import.meta.url);
const key = crypto.createPrivateKey(fs.readFileSync(process.env.EPEIRA_SIGNING_KEY || path.join(os.homedir(), '.epeira-release/update-signing-key.pem')));
const pub = crypto.createPublicKey(key).export({type: 'spki', format: 'der'}).toString('base64');
if (!fs.readFileSync(here('main.js'), 'utf8').includes(pub)) throw new Error('이 비밀 키는 앱(main.js)에 든 공개 키와 짝이 아니에요');
const {version} = JSON.parse(fs.readFileSync(here('package.json'), 'utf8'));
for (const name of [`Epeira-${version}-arm64.dmg`, `Epeira-${version}.dmg`]) {
  fs.writeFileSync(here(`dist/${name}.sig`), `${crypto.sign(null, fs.readFileSync(here(`dist/${name}`)), key).toString('base64')}\n`);
  console.log(`서명함: dist/${name}.sig`);
}
