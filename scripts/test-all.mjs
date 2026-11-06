import {execFileSync} from 'node:child_process';
const scripts=['build-custom','test-custom','test-attendance','test-commerce','test-front','test-seo','test-pdf-mail','test-cloudflare','test-maps'];
for(const script of scripts)execFileSync(process.execPath,['scripts/'+script+'.mjs'],{stdio:'inherit'});
console.log('All Gardening checks passed.');
