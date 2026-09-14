import fs from 'fs';

const raw = fs.readFileSync(0, 'utf8');
const re = /<option value="(\d+)">(.+?) \+(\d+)<\/option>/g;
const list = [];
let m;
while ((m = re.exec(raw)) !== null) {
  list.push({ dialCode: m[1], name: m[2].trim() });
}
const out = `export interface CountryDialOption {
  dialCode: string;
  name: string;
}

export const COUNTRY_DIAL_OPTIONS: CountryDialOption[] = ${JSON.stringify(list, null, 2)};

export const DEFAULT_DIAL_CODE = '91';
`;
fs.writeFileSync('src/app/components/pages/login/login-country-codes.ts', out);
console.log('wrote', list.length, 'countries');
